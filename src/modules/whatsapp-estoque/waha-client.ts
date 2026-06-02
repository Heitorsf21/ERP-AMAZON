import { logger } from "@/lib/logger";
import { assertSafeHttpUrl, parseHostAllowlistEnv } from "@/lib/ssrf-guard";

const log = logger.child({ modulo: "whatsapp-estoque/waha" });

export const WAHA_TIMEOUT_MS_DEFAULT = 15_000;

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

/**
 * Envia uma mensagem de texto via WAHA (POST /api/sendText).
 * Nunca lanca: erros de rede/timeout/HTTP viram resultado normalizado.
 * Mascara destino e token em logs.
 */
export async function enviarTextoWaha(
  input: EnviarTextoWahaInput,
): Promise<EnviarTextoWahaResult> {
  const { baseUrl, session, apiKey, destino, texto } = input;
  const timeoutMs = input.timeoutMs ?? WAHA_TIMEOUT_MS_DEFAULT;

  const urlBase = baseUrl.trim().replace(/\/+$/, "");
  if (!urlBase) {
    return { ok: false, status: 0, erro: "URL do WAHA nao configurada" };
  }
  // SSRF guard: a URL do WAHA vem de config (ADMIN). Em produção exigimos
  // allowlist explícita; sem ela, um host arbitrário vira canal de SSRF.
  try {
    const allowedHosts = parseHostAllowlistEnv(process.env.WAHA_ALLOWED_HOSTS);
    if (process.env.NODE_ENV === "production" && allowedHosts.length === 0) {
      throw new Error("WAHA_ALLOWED_HOSTS obrigatório em produção");
    }
    assertSafeHttpUrl(urlBase, {
      allowedHosts,
    });
  } catch {
    log.error({}, "URL do WAHA bloqueada pelo guard de SSRF (esquema/host invalido)");
    return { ok: false, status: 0, erro: "URL do WAHA invalida ou bloqueada" };
  }
  const chatId = normalizarChatId(destino);
  const url = `${urlBase}/api/sendText`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey && apiKey.trim()) headers["X-Api-Key"] = apiKey.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ session, chatId, text: texto }),
      signal: controller.signal,
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
  } catch (err) {
    const abortado =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    const erro = abortado
      ? `Timeout apos ${timeoutMs}ms ao chamar WAHA`
      : err instanceof Error
        ? err.message
        : "Erro desconhecido ao chamar WAHA";
    log.error(
      { destino: mascararDestino(destino), abortado },
      "Erro de rede ao enviar texto via WAHA",
    );
    return { ok: false, status: 0, erro };
  } finally {
    clearTimeout(timer);
  }
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
