import { db } from "@/lib/db";
import {
  extractAmazonRefunds,
  normalizeFinanceTransaction,
  refundCobreVenda,
  type NormalizedAmazonRefund,
} from "@/modules/amazon/finance-normalizer";

type VendaRefundLookup = {
  id: string;
  amazonOrderId: string;
  sku: string;
  asin: string | null;
  titulo: string | null;
  quantidade: number;
  valorBrutoCentavos: number | null;
  statusPedido: string;
  statusFinanceiro: string;
};

export type MaterializacaoReembolsoAcao = {
  tipo:
    | "CRIAR_REEMBOLSO"
    | "ATUALIZAR_REEMBOLSO"
    | "MARCAR_VENDA_REEMBOLSADA"
    | "IGNORAR";
  refund: NormalizedAmazonRefund;
  venda?: VendaRefundLookup;
  motivo?: string;
};

export type MaterializacaoReembolsosResultado = {
  lidas: number;
  refundsNormalizados: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  vendasMarcadasReembolso: number;
  pendentesValidacao: number;
  acoes: MaterializacaoReembolsoAcao[];
};

export type UpsertFinanceTransactionsResultado = {
  criadas: number;
  atualizadas: number;
  ignoradas: number;
  reembolsosCriados: number;
  reembolsosAtualizados: number;
  reembolsosIgnorados: number;
  vendasMarcadasReembolso: number;
  refundsPendentesValidacao: number;
};

export function shouldAutoApplyAmazonRefunds() {
  return process.env.AMAZON_REFUNDS_AUTO_APPLY === "true";
}

export async function upsertAmazonFinanceTransactions(
  transactions: unknown[],
  options: { materializarReembolsos?: boolean } = {},
): Promise<UpsertFinanceTransactionsResultado> {
  let criadas = 0;
  let atualizadas = 0;
  let ignoradas = 0;

  for (const tx of transactions) {
    const normalized = normalizeFinanceTransaction(tx);
    if (!normalized?.transactionId) {
      ignoradas++;
      continue;
    }

    const data = {
      transactionType: normalized.transactionType,
      transactionStatus: normalized.transactionStatus,
      description: normalized.description,
      postedDate: normalized.postedDate,
      marketplaceId: normalized.marketplaceId,
      amazonOrderId: normalized.amazonOrderId,
      sku: normalized.items.find((item) => item.sku)?.sku ?? null,
      totalAmountCentavos: normalized.totalAmountCentavos,
      totalAmountCurrency: normalized.totalAmountCurrency,
      payload: JSON.stringify(normalized.raw),
    };

    const existente = await db.amazonFinanceTransaction.findUnique({
      where: { transactionId: normalized.transactionId },
    });

    if (existente) {
      await db.amazonFinanceTransaction.update({
        where: { transactionId: normalized.transactionId },
        data,
      });
      atualizadas++;
    } else {
      await db.amazonFinanceTransaction.create({
        data: { transactionId: normalized.transactionId, ...data },
      });
      criadas++;
    }
  }

  const materializacao = options.materializarReembolsos
    ? await materializarReembolsosAmazon(transactions, { dryRun: false })
    : null;

  return {
    criadas,
    atualizadas,
    ignoradas,
    reembolsosCriados: materializacao?.criados ?? 0,
    reembolsosAtualizados: materializacao?.atualizados ?? 0,
    reembolsosIgnorados: materializacao?.ignorados ?? 0,
    vendasMarcadasReembolso: materializacao?.vendasMarcadasReembolso ?? 0,
    refundsPendentesValidacao: materializacao?.pendentesValidacao ?? 0,
  };
}

export async function materializarReembolsosAmazon(
  transactions: unknown[],
  options: { dryRun?: boolean; marcarVendaReembolsada?: boolean } = {},
): Promise<MaterializacaoReembolsosResultado> {
  const dryRun = options.dryRun ?? true;
  const marcarVendaReembolsada = options.marcarVendaReembolsada ?? true;
  const refunds = extractAmazonRefunds(transactions);
  const acoes: MaterializacaoReembolsoAcao[] = [];

  let criados = 0;
  let atualizados = 0;
  let ignorados = 0;
  let vendasMarcadasReembolso = 0;
  let pendentesValidacao = 0;

  for (const refund of refunds) {
    const venda = await db.vendaAmazon.findFirst({
      where: {
        amazonOrderId: refund.amazonOrderId,
        sku: refund.sku,
      },
      select: {
        id: true,
        amazonOrderId: true,
        sku: true,
        asin: true,
        titulo: true,
        quantidade: true,
        valorBrutoCentavos: true,
        statusPedido: true,
        statusFinanceiro: true,
      },
    });

    if (!venda) {
      ignorados++;
      acoes.push({
        tipo: "IGNORAR",
        refund,
        motivo: "VendaAmazon nao encontrada para ORDER_ID + SKU",
      });
      continue;
    }

    const referencias = [
      refund.refundKey,
      refund.refundId,
      ...refund.sourceTransactionIds,
    ].filter((value): value is string => Boolean(value));

    const existente = await db.amazonReembolso.findFirst({
      where: { referenciaExterna: { in: referencias } },
    });
    const produto = await db.produto.findFirst({
      where: { sku: refund.sku },
      select: { id: true, asin: true },
    });

    const data = {
      amazonOrderId: refund.amazonOrderId,
      orderItemId: null,
      sku: refund.sku,
      asin: refund.asin ?? venda.asin ?? produto?.asin ?? null,
      titulo: refund.titulo ?? venda.titulo ?? null,
      quantidade: refund.quantidade,
      valorReembolsadoCentavos: refund.valorReembolsadoCentavos,
      taxasReembolsadasCentavos: refund.taxasReembolsadasCentavos,
      dataReembolso: refund.dataReembolso,
      liquidacaoId: refund.liquidacaoId,
      marketplace: refund.marketplace,
      statusFinanceiro: refund.transactionStatus ?? "REEMBOLSADO",
      motivoCategoria: "FINANCE_TRANSACTION_REFUND",
      produtoId: produto?.id ?? null,
    };

    if (existente) {
      atualizados++;
      acoes.push({ tipo: "ATUALIZAR_REEMBOLSO", refund, venda });
      if (!dryRun) {
        await db.amazonReembolso.update({
          where: { id: existente.id },
          data,
        });
      }
    } else {
      criados++;
      acoes.push({ tipo: "CRIAR_REEMBOLSO", refund, venda });
      if (!dryRun) {
        await db.amazonReembolso.create({
          data: {
            ...data,
            referenciaExterna: refund.refundKey,
          },
        });
      }
    }

    const vendaJaMarcada =
      venda.statusPedido === "REEMBOLSADO" ||
      venda.statusFinanceiro === "REEMBOLSADO";
    const cobreVenda = refundCobreVenda(refund, venda.valorBrutoCentavos);

    if (!cobreVenda) {
      pendentesValidacao++;
      acoes.push({
        tipo: "IGNORAR",
        refund,
        venda,
        motivo: "Refund financeiro parcial; venda nao sera marcada como totalmente reembolsada sem validacao externa",
      });
      continue;
    }

    if (marcarVendaReembolsada && !vendaJaMarcada) {
      vendasMarcadasReembolso++;
      acoes.push({ tipo: "MARCAR_VENDA_REEMBOLSADA", refund, venda });
      if (!dryRun) {
        await db.vendaAmazon.update({
          where: { id: venda.id },
          data: {
            statusPedido: "REEMBOLSADO",
            statusFinanceiro: "REEMBOLSADO",
            impostoSimplesCentavos: 0,
            ultimaSyncEm: new Date(),
          },
        });
      }
    }
  }

  return {
    lidas: transactions.length,
    refundsNormalizados: refunds.length,
    criados,
    atualizados,
    ignorados,
    vendasMarcadasReembolso,
    pendentesValidacao,
    acoes,
  };
}
