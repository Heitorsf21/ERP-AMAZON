import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { TIMEZONE } from "@/lib/date";
import { logger } from "@/lib/logger";
import { emitirNotificacao, resolverNotificacoes } from "@/lib/notificacoes";
import { TipoNotificacao } from "@/modules/shared/domain";
import { getWhatsappEstoqueConfig } from "./config";
import { montarPartesMensagem } from "./message";
import type { FaixaEstoque } from "./schemas";
import { obterResumoEstoqueWhatsApp } from "./service";
import {
  enviarTextoWaha,
  obterStatusSessaoWaha,
  reiniciarSessaoWaha,
  type SessaoWahaInput,
} from "./waha-client";

const log = logger.child({ modulo: "whatsapp-estoque/jobs" });

export type TipoEnvioResumo = "DIARIO" | "TESTE";

export const StatusEnvio = {
  SUCESSO: "SUCESSO",
  ERRO: "ERRO",
  SKIPPED: "SKIPPED",
  ENVIANDO: "ENVIANDO",
} as const;
export type StatusEnvio = (typeof StatusEnvio)[keyof typeof StatusEnvio];

export type ResultadoEnvioResumo = {
  status: StatusEnvio;
  envioId?: string;
  partes: number;
  totais?: Record<FaixaEstoque, number>;
  totalProdutos?: number;
  erro?: string;
};

/**
 * Chave ESTÁVEL do aviso de falha (sem data): um aviso por incidente, não um
 * por dia. Some quando o envio volta a funcionar (`resolverNotificacoes`).
 */
export const DEDUPE_FALHA_WHATSAPP_ESTOQUE = "whatsapp_estoque_falha";

/** Erro gravado quando a sessão do WAHA pede leitura de QR (aparelho desvinculado). */
export const ERRO_WHATSAPP_DESCONECTADO =
  "WhatsApp desconectado: reconecte em Configurações → Integrações (escaneie o QR com o celular da conta)";

/** Intervalo e teto da espera pela sessão voltar após o reinício automático. */
export const SESSAO_POLL_INTERVALO_MS = 3_000;
export const SESSAO_POLL_TETO_MS = 30_000;

const dormirPadrao = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Data local (America/Sao_Paulo) em formato yyyy-MM-dd. */
export function dataLocalSaoPaulo(date = new Date()): string {
  return format(toZonedTime(date, TIMEZONE), "yyyy-MM-dd");
}

export type UltimoEnvioResumo = {
  tipo: string;
  status: string;
  partes: number;
  erro: string | null;
  iniciadoEm: string;
  concluidoEm: string | null;
};

/** Ultimo registro de envio (para exibir status na UI). */
export async function obterUltimoEnvio(): Promise<UltimoEnvioResumo | null> {
  const envio = await db.whatsAppEstoqueEnvio.findFirst({
    orderBy: { iniciadoEm: "desc" },
    select: {
      tipo: true,
      status: true,
      partes: true,
      erro: true,
      iniciadoEm: true,
      concluidoEm: true,
    },
  });
  if (!envio) return null;
  return {
    tipo: envio.tipo,
    status: envio.status,
    partes: envio.partes,
    erro: envio.erro,
    iniciadoEm: envio.iniciadoEm.toISOString(),
    concluidoEm: envio.concluidoEm?.toISOString() ?? null,
  };
}

function preview(texto: string, limite = 280): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite)}…`;
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function notificarFalha(erro: string): Promise<void> {
  try {
    await emitirNotificacao({
      tipo: TipoNotificacao.CONFIG_REVIEW,
      titulo: "Resumo de estoque WhatsApp falhou",
      descricao: erro.slice(0, 280),
      linkRef: "/configuracoes?tab=integracoes",
      dedupeKey: DEDUPE_FALHA_WHATSAPP_ESTOQUE,
      // Incidente contínuo: atualiza o texto, mas não volta a "não lido" a cada dia.
      reabrirSeLida: false,
    });
  } catch (err) {
    log.error({ err: mensagemDe(err) }, "Falha ao emitir aviso do resumo de estoque");
  }
}

/** O envio voltou a funcionar: some o aviso do incidente (nunca quebra o envio). */
async function resolverAvisoFalha(): Promise<void> {
  try {
    await resolverNotificacoes([DEDUPE_FALHA_WHATSAPP_ESTOQUE]);
  } catch (err) {
    log.warn({ err: mensagemDe(err) }, "Falha ao resolver aviso do resumo de estoque");
  }
}

type FalhaEnvio = { indice: number; erro: string };

/** Envia as partes a partir de `inicio`; devolve a primeira falha (ou null). */
async function enviarPartes(args: {
  sessao: SessaoWahaInput;
  destino: string;
  partes: string[];
  inicio: number;
}): Promise<FalhaEnvio | null> {
  const { sessao, destino, partes, inicio } = args;
  for (const [deslocamento, texto] of partes.slice(inicio).entries()) {
    const i = inicio + deslocamento;
    const resultado = await enviarTextoWaha({
      baseUrl: sessao.baseUrl,
      session: sessao.session,
      apiKey: sessao.apiKey,
      destino,
      texto,
    });
    if (!resultado.ok) {
      const motivo = resultado.erro ?? "erro desconhecido";
      return {
        indice: i,
        erro:
          partes.length > 1
            ? `Falha na parte ${i + 1}/${partes.length}: ${motivo}`
            : motivo,
      };
    }
  }
  return null;
}

type DiagnosticoSessao =
  | { acao: "REENVIAR" }
  | { acao: "RECONECTAR_QR" }
  | { acao: "DESISTIR"; detalhe?: string };

/**
 * Depois de uma falha de envio, olha a sessão do WAHA:
 * - FAILED/STOPPED → reinicia e consulta a cada 3 s por até 30 s:
 *   WORKING → vale reenviar; SCAN_QR_CODE → precisa reconectar pelo celular.
 * - SCAN_QR_CODE logo de cara → precisa reconectar.
 * - Qualquer outro caso (WORKING, consulta falhou…) → mantém o erro original.
 */
async function diagnosticarSessao(
  sessao: SessaoWahaInput,
  dormir: (ms: number) => Promise<void>,
): Promise<DiagnosticoSessao> {
  const inicial = await obterStatusSessaoWaha(sessao);
  if (!inicial.ok) return { acao: "DESISTIR" };
  if (inicial.status === "SCAN_QR_CODE") return { acao: "RECONECTAR_QR" };
  if (inicial.status !== "FAILED" && inicial.status !== "STOPPED") {
    return { acao: "DESISTIR" };
  }

  log.warn({ status: inicial.status }, "Sessão do WAHA caída; reiniciando");
  const reinicio = await reiniciarSessaoWaha(sessao);
  if (!reinicio.ok) {
    return {
      acao: "DESISTIR",
      detalhe: `sessão do WhatsApp ${inicial.status}; o reinício falhou (${reinicio.erro ?? "erro desconhecido"})`,
    };
  }

  let ultimoStatus: string = inicial.status;
  // Teto contado pelas esperas E pelo relógio: consultas lentas (timeout) não
  // podem esticar a janela de 30 s.
  const inicio = Date.now();
  for (
    let esperado = 0;
    esperado < SESSAO_POLL_TETO_MS && Date.now() - inicio < SESSAO_POLL_TETO_MS;
    esperado += SESSAO_POLL_INTERVALO_MS
  ) {
    await dormir(SESSAO_POLL_INTERVALO_MS);
    const atual = await obterStatusSessaoWaha(sessao);
    if (!atual.ok || !atual.status) continue;
    ultimoStatus = atual.status;
    if (atual.status === "WORKING") return { acao: "REENVIAR" };
    if (atual.status === "SCAN_QR_CODE") return { acao: "RECONECTAR_QR" };
  }
  return {
    acao: "DESISTIR",
    detalhe: `sessão do WhatsApp não voltou após reiniciar (status ${ultimoStatus})`,
  };
}

/**
 * Gera o resumo de estoque e envia via WAHA, registrando o resultado em
 * `WhatsAppEstoqueEnvio`. NUNCA lanca: qualquer falha vira status ERRO/SKIPPED
 * no resultado (evita retry agressivo na fila do worker).
 *
 * Se o envio falhar, consulta a sessão do WAHA: caída (FAILED/STOPPED) é
 * reiniciada e, se voltar a WORKING em até 30 s, reenvia UMA vez a partir da
 * parte que falhou; pedindo QR (SCAN_QR_CODE), o erro orienta reconectar pela UI.
 *
 * - `tipo` "DIARIO": disparado pelo worker. Em erro, gera notificacao no sino
 *   (um aviso por incidente, chave estável que não reabre).
 * - `tipo` "TESTE": disparado pelo botao da UI. O resultado e exibido direto
 *   ao usuario, entao nao gera notificacao.
 * - Em SUCESSO (qualquer tipo), o aviso do incidente é resolvido.
 * - `dormir`: espera entre as consultas da sessão (injetável nos testes).
 */
export async function runWhatsappEstoqueResumo(args: {
  tipo: TipoEnvioResumo;
  dormir?: (ms: number) => Promise<void>;
}): Promise<ResultadoEnvioResumo> {
  const { tipo } = args;
  const dormir = args.dormir ?? dormirPadrao;
  const config = await getWhatsappEstoqueConfig();
  const destino = config.destinatario;

  if (!config.wahaUrl || !destino) {
    const erro = "Configuracao incompleta: defina a URL do WAHA e o destinatario.";
    await db.whatsAppEstoqueEnvio.create({
      data: {
        tipo,
        status: StatusEnvio.SKIPPED,
        destino: destino || "",
        partes: 0,
        erro,
        concluidoEm: new Date(),
      },
    });
    if (tipo === "DIARIO") await notificarFalha(erro);
    return { status: StatusEnvio.SKIPPED, partes: 0, erro };
  }

  const resumo = await obterResumoEstoqueWhatsApp();
  const partes = montarPartesMensagem(resumo);

  const envio = await db.whatsAppEstoqueEnvio.create({
    data: {
      tipo,
      status: StatusEnvio.ENVIANDO,
      destino,
      partes: partes.length,
      totaisJson: JSON.stringify(resumo.totais),
      mensagemPreview: preview(partes.join("\n\n")),
    },
  });

  const sessao: SessaoWahaInput = {
    baseUrl: config.wahaUrl,
    session: config.wahaSession,
    apiKey: config.wahaApiKey || undefined,
  };

  let falha = await enviarPartes({ sessao, destino, partes, inicio: 0 });
  if (falha) {
    const diagnostico = await diagnosticarSessao(sessao, dormir);
    if (diagnostico.acao === "REENVIAR") {
      log.info(
        { tipo, envioId: envio.id, aPartirDaParte: falha.indice + 1 },
        "Sessão do WAHA voltou; reenviando o resumo",
      );
      falha = await enviarPartes({
        sessao,
        destino,
        partes,
        inicio: falha.indice,
      });
    } else if (diagnostico.acao === "RECONECTAR_QR") {
      falha = { ...falha, erro: ERRO_WHATSAPP_DESCONECTADO };
    } else if (diagnostico.detalhe) {
      falha = { ...falha, erro: `${falha.erro} — ${diagnostico.detalhe}` };
    }
  }
  const erroEnvio = falha?.erro;

  const status = erroEnvio ? StatusEnvio.ERRO : StatusEnvio.SUCESSO;
  await db.whatsAppEstoqueEnvio.update({
    where: { id: envio.id },
    data: { status, erro: erroEnvio, concluidoEm: new Date() },
  });

  if (erroEnvio) {
    log.warn({ tipo, envioId: envio.id }, "Envio de resumo de estoque falhou");
    if (tipo === "DIARIO") await notificarFalha(erroEnvio);
  } else {
    log.info(
      { tipo, envioId: envio.id, partes: partes.length },
      "Resumo de estoque enviado",
    );
    await resolverAvisoFalha();
  }

  return {
    status,
    envioId: envio.id,
    partes: partes.length,
    totais: resumo.totais,
    totalProdutos: resumo.totalProdutos,
    erro: erroEnvio,
  };
}
