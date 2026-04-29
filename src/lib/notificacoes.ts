/**
 * Helpers para gerar notificações operacionais no sino do ERP.
 *
 * Toda notificação tem:
 *  - tipo (constante TipoNotificacao)
 *  - titulo + descricao
 *  - dedupeKey opcional (evita criar duplicata enquanto a key continuar igual)
 *  - linkRef opcional (rota interna para o usuário clicar)
 */
import { db } from "@/lib/db";
import { TipoNotificacao } from "@/modules/shared/domain";

type EmitirOptions = {
  tipo: (typeof TipoNotificacao)[keyof typeof TipoNotificacao];
  titulo: string;
  descricao: string;
  linkRef?: string;
  /**
   * Quando informado, garante que só existe UMA notificação ativa com essa key.
   * Útil pra alertas que poderiam ser repetidos (ex: estoque crítico do mesmo SKU
   * num mesmo dia). Se já existir, faz update do conteúdo (mantém ID).
   */
  dedupeKey?: string;
};

export async function emitirNotificacao(opts: EmitirOptions) {
  if (!opts.dedupeKey) {
    return db.notificacao.create({
      data: {
        tipo: opts.tipo,
        titulo: opts.titulo,
        descricao: opts.descricao,
        linkRef: opts.linkRef,
      },
    });
  }

  return db.notificacao.upsert({
    where: { dedupeKey: opts.dedupeKey },
    create: {
      tipo: opts.tipo,
      titulo: opts.titulo,
      descricao: opts.descricao,
      linkRef: opts.linkRef,
      dedupeKey: opts.dedupeKey,
    },
    update: {
      titulo: opts.titulo,
      descricao: opts.descricao,
      linkRef: opts.linkRef,
      lida: false,
    },
  });
}

/**
 * Constrói uma dedupeKey baseada no dia (UTC) — alertas com mesma key
 * só geram uma notificação por dia.
 */
export function diaUTC(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// ── Geradores específicos ───────────────────────────────────────────

export function notificarEstoqueCritico(args: {
  sku: string;
  estoqueAtual: number;
  estoqueMinimo: number;
}) {
  return emitirNotificacao({
    tipo: TipoNotificacao.ESTOQUE_CRITICO,
    titulo: `Estoque critico: ${args.sku}`,
    descricao: `Atual ${args.estoqueAtual} <= minimo ${args.estoqueMinimo}.`,
    linkRef: `/produtos?busca=${encodeURIComponent(args.sku)}`,
    dedupeKey: `estoque_critico:${args.sku}:${diaUTC()}`,
  });
}

export function notificarBuyboxPerdido(args: {
  sku: string;
  precoNosso?: number | null;
  precoBuybox?: number | null;
  sellerBuybox?: string | null;
}) {
  const detalhes =
    args.precoNosso && args.precoBuybox
      ? ` Nosso R$ ${(args.precoNosso / 100).toFixed(2)} vs buybox R$ ${(args.precoBuybox / 100).toFixed(2)}.`
      : "";
  return emitirNotificacao({
    tipo: TipoNotificacao.BUYBOX_PERDIDO,
    titulo: `Buybox perdido: ${args.sku}`,
    descricao: `Outro vendedor tem o buybox.${detalhes}`,
    linkRef: `/produtos?busca=${encodeURIComponent(args.sku)}`,
    dedupeKey: `buybox_perdido:${args.sku}`,
  });
}

export function notificarBuyboxRecuperado(sku: string) {
  return emitirNotificacao({
    tipo: TipoNotificacao.BUYBOX_RECUPERADO,
    titulo: `Buybox recuperado: ${sku}`,
    descricao: "Voltamos a vencer o buybox.",
    linkRef: `/produtos?busca=${encodeURIComponent(sku)}`,
    dedupeKey: `buybox_recuperado:${sku}:${diaUTC()}`,
  });
}

export function notificarJobFalhando(args: {
  jobId: string;
  tipo: string;
  attempts: number;
  error: string;
}) {
  return emitirNotificacao({
    tipo: TipoNotificacao.JOB_FALHANDO,
    titulo: `Job ${args.tipo} falhou ${args.attempts}x`,
    descricao: args.error.slice(0, 280),
    linkRef: `/sistema`,
    dedupeKey: `job_falhando:${args.tipo}:${diaUTC()}`,
  });
}

export function notificarQuotaBloqueada(args: {
  operation: string;
  proximoSlot: Date;
}) {
  return emitirNotificacao({
    tipo: TipoNotificacao.QUOTA_BLOQUEADA,
    titulo: `Quota Amazon ${args.operation} bloqueada`,
    descricao: `Proximo slot ${args.proximoSlot.toISOString()}.`,
    linkRef: `/sistema`,
    dedupeKey: `quota:${args.operation}:${diaUTC()}`,
  });
}

export function notificarSettlementNovo(args: {
  settlementId: string;
  valor: number;
  contasGeradas: number;
}) {
  return emitirNotificacao({
    tipo: TipoNotificacao.SETTLEMENT_NOVO,
    titulo: `Settlement Amazon ${args.settlementId}`,
    descricao: `R$ ${(args.valor / 100).toFixed(2)} importado, ${args.contasGeradas} contas a receber.`,
    linkRef: `/contas-a-receber`,
    dedupeKey: `settlement:${args.settlementId}`,
  });
}

export function notificarReembolsoAlto(args: {
  sku: string;
  valor: number;
  motivo?: string | null;
}) {
  return emitirNotificacao({
    tipo: TipoNotificacao.REEMBOLSO_ALTO,
    titulo: `Reembolso alto: ${args.sku}`,
    descricao: `R$ ${(args.valor / 100).toFixed(2)}${args.motivo ? ` (${args.motivo})` : ""}.`,
    linkRef: `/vendas`,
    dedupeKey: `reembolso_alto:${args.sku}:${diaUTC()}`,
  });
}

export function notificarReimbursementFbaRecebido(args: {
  naturalKey: string;
  sku?: string | null;
  valor: number;
  motivo?: string | null;
}) {
  const sku = args.sku ?? "SKU desconhecido";
  return emitirNotificacao({
    tipo: TipoNotificacao.REIMBURSEMENT_FBA_RECEBIDO,
    titulo: `Ressarcimento FBA recebido: ${sku}`,
    descricao: `R$ ${(args.valor / 100).toFixed(2)}${args.motivo ? ` (${args.motivo})` : ""}.`,
    linkRef: `/financeiro/dashboard`,
    dedupeKey: `reimbursement_fba:${args.naturalKey}`,
  });
}

export function notificarReconciliado(args: {
  contaReceberId: string;
  valor: number;
}) {
  return emitirNotificacao({
    tipo: TipoNotificacao.RECEBIMENTO_RECONCILIADO,
    titulo: "Recebimento Amazon reconciliado",
    descricao: `Conta a receber liquidada por R$ ${(args.valor / 100).toFixed(2)}.`,
    linkRef: `/contas-a-receber`,
  });
}
