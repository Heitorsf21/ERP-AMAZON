import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { TIMEZONE } from "@/lib/date";
import { logger } from "@/lib/logger";
import { emitirNotificacao } from "@/lib/notificacoes";
import { TipoNotificacao } from "@/modules/shared/domain";
import { getWhatsappEstoqueConfig } from "./config";
import { montarPartesMensagem } from "./message";
import type { FaixaEstoque } from "./schemas";
import { obterResumoEstoqueWhatsApp } from "./service";
import { enviarTextoWaha } from "./waha-client";

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

async function notificarFalha(erro: string): Promise<void> {
  await emitirNotificacao({
    tipo: TipoNotificacao.CONFIG_REVIEW,
    titulo: "Resumo de estoque WhatsApp falhou",
    descricao: erro.slice(0, 280),
    linkRef: "/configuracoes",
    dedupeKey: `whatsapp_estoque_falha:${dataLocalSaoPaulo()}`,
  });
}

/**
 * Gera o resumo de estoque e envia via WAHA, registrando o resultado em
 * `WhatsAppEstoqueEnvio`. NUNCA lanca: qualquer falha vira status ERRO/SKIPPED
 * no resultado (evita retry agressivo na fila do worker).
 *
 * - `tipo` "DIARIO": disparado pelo worker. Em erro, gera notificacao no sino.
 * - `tipo` "TESTE": disparado pelo botao da UI. O resultado e exibido direto
 *   ao usuario, entao nao gera notificacao.
 */
export async function runWhatsappEstoqueResumo(args: {
  tipo: TipoEnvioResumo;
}): Promise<ResultadoEnvioResumo> {
  const { tipo } = args;
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

  let erroEnvio: string | undefined;
  for (const [i, parte] of partes.entries()) {
    const resultado = await enviarTextoWaha({
      baseUrl: config.wahaUrl,
      session: config.wahaSession,
      apiKey: config.wahaApiKey || undefined,
      destino,
      texto: parte,
    });
    if (!resultado.ok) {
      erroEnvio =
        partes.length > 1
          ? `Falha na parte ${i + 1}/${partes.length}: ${resultado.erro ?? "erro desconhecido"}`
          : (resultado.erro ?? "erro desconhecido");
      break;
    }
  }

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
