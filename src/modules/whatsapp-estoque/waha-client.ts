import { logger } from "@/lib/logger";
import { assertSafeHttpUrl, parseHostAllowlistEnv } from "@/lib/ssrf-guard";

const log = logger.child({ modulo: "whatsapp-estoque/waha" });

export const WAHA_TIMEOUT_MS_DEFAULT = 15_000;
/** Consultas de sessão (status/reinício/QR) são leves: timeout menor. */
export const WAHA_SESSAO_TIMEOUT_MS_DEFAULT = 10_000;
/** Teto do PNG do QR aceito do upstream (um QR real tem poucos KB). */
const QR_TAMANHO_MAX_BYTES = 512 * 1024;
const PNG_ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Status de sessão documentados pelo WAHA. */
export const STATUS_SESSAO_WAHA = [
  "STOPPED",
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "FAILED",
] as const;
export type StatusSessaoWaha =
  | (typeof STATUS_SESSAO_WAHA)[number]
  | "DESCONHECIDO";

export type EnviarTextoWahaInput = {
  baseUrl: string;
  session: string;
  apiKey?: string;
  /** Numero (apenas digitos) ou chatId completo (ex: 5511999999999@c.us). */
  destino: string;
  texto: string;
  timeoutMs?: number;
};

export type EnviarTextoWahaResult = {
  ok: boolean;
  status: number;
  idMensagem?: string;
  erro?: string;
};

export type SessaoWahaInput = {
  baseUrl: string;
  session: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type StatusSessaoWahaResult = {
  ok: boolean;
  status?: StatusSessaoWaha;
  /** Só os 4 últimos dígitos do número pareado (nunca o número inteiro). */
  conta?: string;
  erro?: string;
};

export type ReiniciarSessaoWahaResult = { ok: boolean; erro?: string };

export type QrSessaoWahaResult = {
  ok: boolean;
  /** `data:image/png;base64,...` — só quando o upstream devolveu um PNG real. */
  dataUrl?: string;
  erro?: string;
};

/**
 * Normaliza o destino para o chatId esperado pelo WAHA. Se ja vier com "@"
 * (chatId/group id), usa como esta; caso contrario remove tudo que nao for
 * digito e adiciona o sufixo "@c.us".
 */
export function normalizarChatId(destino: string): string {
  const valor = destino.trim();
  if (valor.includes("@")) return valor;
  const digitos = valor.replace(/\D/g, "");
  return `${digitos}@c.us`;
}

/**
 * Mascara um destino/numero para logs (mantem ultimos 4 digitos).
 */
export function mascararDestino(destino: string): string {
  const digitos = destino.replace(/\D/g, "");
  if (digitos.length <= 4) return "****";
  return `****${digitos.slice(-4)}`;
}

type UrlWahaValidada = { ok: true; urlBase: string } | { ok: false; erro: string };

/**
 * Normaliza e valida a URL base do WAHA contra SSRF. A URL vem de config
 * (ADMIN): em produção exigimos allowlist explícita (`WAHA_ALLOWED_HOSTS`);
 * sem ela, um host arbitrário vira canal de SSRF. Nunca registra a URL bruta.
 */
function validarUrlWaha(baseUrl: string): UrlWahaValidada {
  const urlBase = baseUrl.trim().replace(/\/+$/, "");
  if (!urlBase) {
    return { ok: false, erro: "URL do WAHA nao configurada" };
  }
  const allowedHosts = parseHostAllowlistEnv(process.env.WAHA_ALLOWED_HOSTS);
  if (process.env.NODE_ENV === "production" && allowedHosts.length === 0) {
    log.error(
      { codigo: "WAHA_ALLOWED_HOSTS_AUSENTE" },
      "WAHA_ALLOWED_HOSTS nao configurado em producao",
    );
    return { ok: false, erro: "WAHA_ALLOWED_HOSTS nao configurado no servidor" };
  }

  try {
    assertSafeHttpUrl(urlBase, { allowedHosts });
  } catch {
    let host = "invalido";
    try {
      host = new URL(urlBase).host;
    } catch {
      // Mantem apenas um marcador seguro; nao registra a URL bruta.
    }
    log.error(
      { codigo: "WAHA_URL_NAO_PERMITIDA", host },
      "URL do WAHA bloqueada pelo guard de SSRF",
    );
    return {
      ok: false,
      erro: "URL do WAHA invalida ou fora de WAHA_ALLOWED_HOSTS",
    };
  }
  return { ok: true, urlBase };
}

function montarHeaders(
  apiKey: string | undefined,
  extras: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...extras };
  if (apiKey && apiKey.trim()) headers["X-Api-Key"] = apiKey.trim();
  return headers;
}

function ehAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

function mensagemErroRede(err: unknown, timeoutMs: number): string {
  if (ehAbort(err)) return `Timeout apos ${timeoutMs}ms ao chamar WAHA`;
  return err instanceof Error ? err.message : "Erro desconhecido ao chamar WAHA";
}

/** Executa `fn` com um AbortSignal que dispara após `timeoutMs`. */
async function comTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Libera a conexão sem usar o corpo (que nunca é refletido ao caller). */
async function descartarCorpo(resp: Response): Promise<void> {
  try {
    await resp.arrayBuffer();
  } catch {
    // corpo ilegível: irrelevante, o resultado já foi decidido pelo status.
  }
}

/**
 * Envia uma mensagem de texto via WAHA (POST /api/sendText).
 * Nunca lanca: erros de rede/timeout/HTTP viram resultado normalizado.
 * Mascara destino e token em logs.
 */
export async function enviarTextoWaha(
  input: EnviarTextoWahaInput,
): Promise<EnviarTextoWahaResult> {
  const { session, apiKey, destino, texto } = input;
  const timeoutMs = input.timeoutMs ?? WAHA_TIMEOUT_MS_DEFAULT;

  const validacao = validarUrlWaha(input.baseUrl);
  if (!validacao.ok) return { ok: false, status: 0, erro: validacao.erro };

  const chatId = normalizarChatId(destino);
  const url = `${validacao.urlBase}/api/sendText`;
  const headers = montarHeaders(apiKey, {
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  try {
    return await comTimeout(timeoutMs, async (signal) => {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ session, chatId, text: texto }),
        signal,
      });

      const corpo = await resp.text();
      if (!resp.ok) {
        log.warn(
          { status: resp.status, destino: mascararDestino(destino) },
          "Falha ao enviar texto via WAHA",
        );
        // NÃO refletir o corpo da resposta upstream no erro retornado ao caller
        // (era canal de exfiltração SSRF via botão de teste). O log.warn acima já
        // registra status + destino mascarado para diagnóstico.
        return {
          ok: false,
          status: resp.status,
          erro: `WAHA respondeu ${resp.status}`,
        };
      }

      const idMensagem = extrairIdMensagem(corpo);
      log.info(
        { status: resp.status, destino: mascararDestino(destino) },
        "Texto enviado via WAHA",
      );
      return { ok: true, status: resp.status, idMensagem };
    });
  } catch (err) {
    log.error(
      { destino: mascararDestino(destino), abortado: ehAbort(err) },
      "Erro de rede ao enviar texto via WAHA",
    );
    return { ok: false, status: 0, erro: mensagemErroRede(err, timeoutMs) };
  }
}

/**
 * Consulta o status da sessão (GET /api/sessions/{session}).
 * Nunca lança. Do corpo upstream só aproveita o status (se for um dos valores
 * documentados; senão "DESCONHECIDO") e os 4 últimos dígitos da conta pareada —
 * nada do corpo cru volta ao caller (anti-exfiltração via SSRF).
 */
export async function obterStatusSessaoWaha(
  input: SessaoWahaInput,
): Promise<StatusSessaoWahaResult> {
  const timeoutMs = input.timeoutMs ?? WAHA_SESSAO_TIMEOUT_MS_DEFAULT;
  const validacao = validarUrlWaha(input.baseUrl);
  if (!validacao.ok) return { ok: false, erro: validacao.erro };

  const url = `${validacao.urlBase}/api/sessions/${encodeURIComponent(input.session)}`;
  const headers = montarHeaders(input.apiKey, { Accept: "application/json" });

  try {
    return await comTimeout(timeoutMs, async (signal) => {
      const resp = await fetch(url, { method: "GET", headers, signal });
      if (!resp.ok) {
        await descartarCorpo(resp);
        log.warn({ status: resp.status }, "Falha ao consultar sessão do WAHA");
        return { ok: false, erro: `WAHA respondeu ${resp.status}` };
      }

      let json: unknown;
      try {
        json = JSON.parse(await resp.text());
      } catch {
        json = null;
      }
      if (!json || typeof json !== "object") {
        log.warn("Resposta não-JSON ao consultar sessão do WAHA");
        return { ok: false, erro: "Resposta inesperada do WAHA" };
      }

      const obj = json as Record<string, unknown>;
      const status = normalizarStatusSessao(obj.status);
      const conta = extrairUltimosDigitosConta(obj.me);
      return conta ? { ok: true, status, conta } : { ok: true, status };
    });
  } catch (err) {
    log.error({ abortado: ehAbort(err) }, "Erro de rede ao consultar sessão do WAHA");
    return { ok: false, erro: mensagemErroRede(err, timeoutMs) };
  }
}

/**
 * Reinicia a sessão (POST /api/sessions/{session}/restart). O WAHA responde
 * 201 e a sessão volta a STARTING (depois WORKING ou SCAN_QR_CODE).
 * Nunca lança.
 */
export async function reiniciarSessaoWaha(
  input: SessaoWahaInput,
): Promise<ReiniciarSessaoWahaResult> {
  const timeoutMs = input.timeoutMs ?? WAHA_SESSAO_TIMEOUT_MS_DEFAULT;
  const validacao = validarUrlWaha(input.baseUrl);
  if (!validacao.ok) return { ok: false, erro: validacao.erro };

  const url = `${validacao.urlBase}/api/sessions/${encodeURIComponent(input.session)}/restart`;
  const headers = montarHeaders(input.apiKey, { Accept: "application/json" });

  try {
    return await comTimeout(timeoutMs, async (signal) => {
      const resp = await fetch(url, { method: "POST", headers, signal });
      await descartarCorpo(resp);
      if (!resp.ok) {
        log.warn({ status: resp.status }, "Falha ao reiniciar sessão do WAHA");
        return { ok: false, erro: `WAHA respondeu ${resp.status}` };
      }
      log.info({ status: resp.status }, "Sessão do WAHA reiniciada");
      return { ok: true };
    });
  } catch (err) {
    log.error({ abortado: ehAbort(err) }, "Erro de rede ao reiniciar sessão do WAHA");
    return { ok: false, erro: mensagemErroRede(err, timeoutMs) };
  }
}

/**
 * Baixa o QR de pareamento (GET /api/{session}/auth/qr?format=image) como PNG.
 * Nunca lança. Só devolve a data URL quando os bytes começam com a assinatura
 * PNG e cabem no teto de tamanho — qualquer outro conteúdo (HTML, JSON, página
 * interna alcançada por SSRF) é descartado sem ser refletido.
 */
export async function obterQrSessaoWaha(
  input: SessaoWahaInput,
): Promise<QrSessaoWahaResult> {
  const timeoutMs = input.timeoutMs ?? WAHA_SESSAO_TIMEOUT_MS_DEFAULT;
  const validacao = validarUrlWaha(input.baseUrl);
  if (!validacao.ok) return { ok: false, erro: validacao.erro };

  const url = `${validacao.urlBase}/api/${encodeURIComponent(input.session)}/auth/qr?format=image`;
  const headers = montarHeaders(input.apiKey, { Accept: "image/png" });

  try {
    return await comTimeout(timeoutMs, async (signal) => {
      const resp = await fetch(url, { method: "GET", headers, signal });
      if (!resp.ok) {
        await descartarCorpo(resp);
        log.warn({ status: resp.status }, "Falha ao obter QR da sessão do WAHA");
        return { ok: false, erro: `WAHA respondeu ${resp.status}` };
      }

      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (!ehPng(bytes) || bytes.byteLength > QR_TAMANHO_MAX_BYTES) {
        log.warn(
          { tamanho: bytes.byteLength },
          "QR do WAHA não é um PNG válido",
        );
        return { ok: false, erro: "Resposta inesperada do WAHA (QR não é PNG)" };
      }
      const base64 = Buffer.from(bytes).toString("base64");
      return { ok: true, dataUrl: `data:image/png;base64,${base64}` };
    });
  } catch (err) {
    log.error({ abortado: ehAbort(err) }, "Erro de rede ao obter QR do WAHA");
    return { ok: false, erro: mensagemErroRede(err, timeoutMs) };
  }
}

function normalizarStatusSessao(valor: unknown): StatusSessaoWaha {
  if (
    typeof valor === "string" &&
    (STATUS_SESSAO_WAHA as readonly string[]).includes(valor)
  ) {
    return valor as StatusSessaoWaha;
  }
  return "DESCONHECIDO";
}

function extrairUltimosDigitosConta(me: unknown): string | undefined {
  if (!me || typeof me !== "object") return undefined;
  const id = (me as Record<string, unknown>).id;
  if (typeof id !== "string") return undefined;
  // Só a parte antes do "@" (ex: 5511999998888@c.us → 5511999998888).
  const digitos = (id.split("@")[0] ?? "").replace(/\D/g, "");
  if (digitos.length < 4) return undefined;
  return digitos.slice(-4);
}

function ehPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_ASSINATURA.length) return false;
  return PNG_ASSINATURA.every((b, i) => bytes[i] === b);
}

function extrairIdMensagem(corpo: string): string | undefined {
  if (!corpo) return undefined;
  try {
    const json = JSON.parse(corpo) as unknown;
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      const id = obj.id;
      if (typeof id === "string") return id;
      if (id && typeof id === "object") {
        const serialized = (id as Record<string, unknown>)._serialized;
        if (typeof serialized === "string") return serialized;
      }
    }
  } catch {
    // resposta nao-JSON: ignora, envio ja foi confirmado pelo status HTTP.
  }
  return undefined;
}
