/**
 * Handlers para os jobs novos (Sprint 3 + Sprint 4):
 *  - SETTLEMENT_REPORT_SYNC : baixa relatórios de liquidação automaticamente
 *  - BUYBOX_CHECK           : checa buybox por SKU rotacionando ASINs
 *  - CATALOG_REFRESH        : atualiza catálogo (imagem, título, categoria)
 *  - reconciliarRecebimentosAmazon: cruza extrato Nubank ↔ ContaReceber
 *
 * Cada handler é chamado pelo worker em src/modules/amazon/worker.ts.
 */
import { db } from "@/lib/db";
import {
  getCatalogItem,
  getInventorySummaries,
  getListingsItem,
  getMyFeesEstimateForSKU,
  getProductOffers,
  getSellerId,
  getSettlementReports,
  listFinancialTransactions,
  type SPAPICredentials,
  type SPCatalogItem,
} from "@/lib/amazon-sp-api";
import { parseAllOrdersTsv } from "@/modules/amazon/parsers/all-orders-tsv";
import { parseFbaReimbursementsTsv } from "@/modules/amazon/parsers/fba-reimbursements-tsv";
import { parseFbaReturnsTsv } from "@/modules/amazon/parsers/fba-returns-tsv";
import { parseFbaStorageFeesTsv } from "@/modules/amazon/parsers/fba-storage-fees-tsv";
import { parseSalesTrafficJson } from "@/modules/amazon/parsers/sales-traffic-json";
import {
  downloadReportDocument,
  stepReportLifecycle,
} from "@/modules/amazon/report-runner";
import {
  shouldAutoApplyAmazonRefunds,
  upsertAmazonFinanceTransactions,
} from "@/modules/amazon/finance-materializer";
import { extractAmazonListingEffectivePriceCentavos } from "@/modules/amazon/pricing";
import { extractProductOfferSnapshot } from "@/modules/amazon/offers-normalizer";
import { inferAmazonCategoriaFee } from "@/modules/produtos/amazon-fee-category-mapper";
import {
  notificarBuyboxPerdido,
  notificarBuyboxRecuperado,
  notificarReconciliado,
  notificarReimbursementFbaRecebido,
  notificarSettlementNovo,
} from "@/lib/notificacoes";
import { contasReceberService } from "@/modules/contas-a-receber/service";
import { agruparLinhasVendaAmazon } from "@/modules/vendas/agrupamento";
import { calcularImpostoSimplesCentavos } from "@/modules/vendas/valores";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import {
  OrigemMovimentacao,
  StatusContaReceber,
  TipoMovimentacao,
} from "@/modules/shared/domain";
import { addDays } from "date-fns";

// ─────────────────────────────────────────────────────────────────────
// SETTLEMENT_REPORT_SYNC
// ─────────────────────────────────────────────────────────────────────

const SETTLEMENT_TYPES = [
  "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
  "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE",
];

export async function syncSettlementReports(creds: SPAPICredentials) {
  const reports = await getSettlementReports(creds, 1);

  let baixados = 0;
  let novos = 0;
  let erros = 0;

  for (const report of reports) {
    if (!report.reportDocumentId) continue;
    if (!report.reportType || !SETTLEMENT_TYPES.includes(report.reportType)) continue;
    if (report.processingStatus && report.processingStatus !== "DONE") continue;

    // Já registrado?
    const existente = await db.amazonSettlementReport.findUnique({
      where: { reportId: report.reportId },
    });
    if (existente?.processadoEm) continue;

    try {
      // Settlement reports já são criados pela Amazon — só precisamos baixar.
      // stepReportLifecycle aceita reportId em estado DONE e devolve o buffer.
      const lifecycle = await stepReportLifecycle(creds, {
        pendingReportId: report.reportId,
        reportType: report.reportType,
      });
      if (lifecycle.status !== "DONE") {
        erros++;
        continue;
      }

      const csvBuffer = lifecycle.buffer;
      const resumo = await contasReceberService.importarAmazonCSV(csvBuffer);
      baixados++;

      const settlementId = resumo.liquidacoes[0]?.liquidacaoId ?? null;
      const valorTotal = resumo.liquidacoes.reduce(
        (s, l) => s + l.totalLiquidoCentavos,
        0,
      );

      await db.amazonSettlementReport.upsert({
        where: { reportId: report.reportId },
        create: {
          reportId: report.reportId,
          reportDocumentId: report.reportDocumentId,
          settlementId,
          totalAmountCentavos: valorTotal,
          processadoEm: new Date(),
          contasGeradas: resumo.liquidacoes.length,
        },
        update: {
          reportDocumentId: report.reportDocumentId,
          settlementId,
          totalAmountCentavos: valorTotal,
          processadoEm: new Date(),
          contasGeradas: resumo.liquidacoes.length,
        },
      });

      if (settlementId) {
        await notificarSettlementNovo({
          settlementId,
          valor: valorTotal,
          contasGeradas: resumo.liquidacoes.length,
        });
      }
      novos++;
      break;
    } catch (err) {
      console.warn("settlement-sync erro:", err);
      erros++;
    }
  }

  return { ok: true, reports: reports.length, baixados, novos, erros };
}

// downloadReportDocument agora vive em ./report-runner (compartilhado com os
// handlers de backfill da Sprint 2 e futuros handlers da Sprint 3).

// ─────────────────────────────────────────────────────────────────────
// BUYBOX_CHECK
// ─────────────────────────────────────────────────────────────────────

const BUYBOX_BATCH_SIZE = 25;

export async function runBuyboxCheck(creds: SPAPICredentials) {
  // Lê `amazon_seller_id` salvo na config para comparar diretamente o
  // sellerId do buybox winner com o nosso. Se não houver (config legado
  // ou sync ainda não executado), caímos no fallback de preço.
  const sellerIdRow = await db.configuracaoSistema.findUnique({
    where: { chave: "amazon_seller_id" },
  });
  const ourSellerId = sellerIdRow?.valor ?? null;

  // Pega SKUs ativos com ASIN, escolhendo os de maior tempo desde o último check.
  const produtos = await db.produto.findMany({
    where: {
      ativo: true,
      asin: { not: null },
    },
    orderBy: [{ buyboxUltimaSyncEm: "asc" }],
    take: BUYBOX_BATCH_SIZE,
    select: {
      id: true,
      sku: true,
      asin: true,
      buyboxGanho: true,
      precoVenda: true,
      amazonPrecoListagemCentavos: true,
    },
  });

  let checados = 0;
  let perdidos = 0;
  let recuperados = 0;

  for (const p of produtos) {
    if (!p.asin) continue;
    const offers = await getProductOffers(creds, p.asin);
    checados++;

    if (!offers) {
      await db.produto.update({
        where: { id: p.id },
        data: { buyboxUltimaSyncEm: new Date() },
      });
      continue;
    }

    const precoNosso = p.amazonPrecoListagemCentavos ?? p.precoVenda;
    const {
      buyboxPriceCentavos,
      sellerBuybox,
      numeroOfertas,
      somosBuybox,
    } = extractProductOfferSnapshot(offers, ourSellerId, precoNosso);

    await db.$transaction([
      db.produto.update({
        where: { id: p.id },
        data: {
          buyboxGanho: somosBuybox,
          buyboxPreco: buyboxPriceCentavos,
          buyboxConcorrentes: numeroOfertas,
          buyboxUltimaSyncEm: new Date(),
        },
      }),
      db.buyBoxSnapshot.create({
        data: {
          produtoId: p.id,
          sku: p.sku,
          asin: p.asin,
          somosBuybox: !!somosBuybox,
          precoNosso,
          precoBuybox: buyboxPriceCentavos,
          sellerBuybox,
          numeroOfertas,
        },
      }),
    ]);

    // Notificações de transição
    if (somosBuybox === false && p.buyboxGanho !== false) {
      perdidos++;
      await notificarBuyboxPerdido({
        sku: p.sku,
        precoNosso,
        precoBuybox: buyboxPriceCentavos,
        sellerBuybox,
      });
    }
    if (somosBuybox === true && p.buyboxGanho === false) {
      recuperados++;
      await notificarBuyboxRecuperado(p.sku);
    }
  }

  return { ok: true, checados, perdidos, recuperados };
}

// ─────────────────────────────────────────────────────────────────────
// CATALOG_REFRESH
// ─────────────────────────────────────────────────────────────────────

const CATALOG_BATCH_SIZE = 20;

export async function runCatalogRefresh(creds: SPAPICredentials) {
  const produtos = await db.produto.findMany({
    where: { ativo: true, asin: { not: null } },
    orderBy: [{ amazonCatalogSyncEm: "asc" }],
    take: CATALOG_BATCH_SIZE,
    select: { id: true, asin: true, amazonCategoriaFee: true },
  });

  let atualizados = 0;
  let semDados = 0;
  let categoriasFeeAtualizadas = 0;
  let categoriasFeeNaoMapeadas = 0;

  for (const p of produtos) {
    if (!p.asin) continue;
    const item = await getCatalogItem(creds, p.asin);

    if (!item) {
      semDados++;
      await db.produto.update({
        where: { id: p.id },
        data: { amazonCatalogSyncEm: new Date() },
      });
      continue;
    }

    const categoriaFee = inferAmazonCategoriaFee(item);
    if (!p.amazonCategoriaFee && !categoriaFee) {
      categoriasFeeNaoMapeadas++;
    }

    await db.produto.update({
      where: { id: p.id },
      data: {
        amazonImagemUrl: extractMainImage(item) ?? undefined,
        amazonTituloOficial: extractTitle(item) ?? undefined,
        amazonCategoria: extractCategory(item) ?? undefined,
        amazonCatalogSyncEm: new Date(),
        ...(!p.amazonCategoriaFee && categoriaFee
          ? { amazonCategoriaFee: categoriaFee.slug }
          : {}),
      },
    });
    if (!p.amazonCategoriaFee && categoriaFee) {
      categoriasFeeAtualizadas++;
    }
    atualizados++;
  }

  return {
    ok: true,
    atualizados,
    semDados,
    categoriasFeeAtualizadas,
    categoriasFeeNaoMapeadas,
  };
}

function extractMainImage(item: SPCatalogItem): string | null {
  for (const group of item.images ?? []) {
    for (const img of group.images ?? []) {
      if (img.variant === "MAIN" || !img.variant) return img.link ?? null;
    }
  }
  return null;
}

function extractTitle(item: SPCatalogItem): string | null {
  return item.summaries?.[0]?.itemName ?? null;
}

function extractCategory(item: SPCatalogItem): string | null {
  for (const group of item.classifications ?? []) {
    const name = group.classifications?.[0]?.displayName;
    if (name) return name;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Reconciliação Nubank ↔ ContaReceber
// ─────────────────────────────────────────────────────────────────────

const RECONCILIA_TOLERANCIA_CENTAVOS = 500; // R$ 5,00
const RECONCILIA_TOLERANCIA_PCT = 0.005; // 0.5 %
const RECONCILIA_DIAS_DELTA = 3;

/**
 * Cruza Movimentação ENTRADA com descrição "Amazon" (ainda não vinculada)
 * com ContaReceber PENDENTE de valor próximo. Vincula automaticamente quando
 * encontra match único.
 *
 * Pode ser chamada após cada importação Nubank ou periodicamente.
 */
export async function reconciliarRecebimentosAmazon() {
  const candidatas = await db.movimentacao.findMany({
    where: {
      tipo: TipoMovimentacao.ENTRADA,
      origem: OrigemMovimentacao.IMPORTACAO,
      descricao: { contains: "Amazon" },
      contaReceber: { is: null },
    },
    take: 100,
    orderBy: { dataCaixa: "desc" },
  });

  let vinculadas = 0;

  for (const mov of candidatas) {
    const tolerancia = Math.max(
      RECONCILIA_TOLERANCIA_CENTAVOS,
      Math.round(mov.valor * RECONCILIA_TOLERANCIA_PCT),
    );
    const lo = mov.valor - tolerancia;
    const hi = mov.valor + tolerancia;
    const dataMin = addDays(mov.dataCaixa, -RECONCILIA_DIAS_DELTA);
    const dataMax = addDays(mov.dataCaixa, RECONCILIA_DIAS_DELTA);

    const matches = await db.contaReceber.findMany({
      where: {
        status: StatusContaReceber.PENDENTE,
        valor: { gte: lo, lte: hi },
        dataPrevisao: { gte: dataMin, lte: dataMax },
      },
      take: 2,
    });

    if (matches.length !== 1) continue;
    const conta = matches[0]!;

    await db.$transaction([
      db.contaReceber.update({
        where: { id: conta.id },
        data: {
          status: StatusContaReceber.RECEBIDA,
          dataRecebimento: mov.dataCaixa,
          movimentacaoId: mov.id,
        },
      }),
    ]);

    vinculadas++;
    await notificarReconciliado({
      contaReceberId: conta.id,
      valor: conta.valor,
    });
  }

  return { ok: true, candidatas: candidatas.length, vinculadas };
}

// ─────────────────────────────────────────────────────────────────────
// REPORTS_BACKFILL — backfill de pedidos via Reports API
// Usa GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL em janelas de 30 dias.
// Cada execução do job avança no máximo UMA janela (cria report → polling em
// runs subsequentes → quando DONE, baixa/upserta/avança cursor). Auto-desliga
// quando o cursor alcança `now - 2 dias`.
// ─────────────────────────────────────────────────────────────────────

const ORDERS_HISTORY_REPORT_TYPE =
  "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";
const ORDERS_HISTORY_CURSOR_KEY = "amazon_orders_history_cursor";
const ORDERS_HISTORY_PENDING_KEY = "amazon_orders_history_pending_report_id";
const ORDERS_HISTORY_PENDING_END_KEY = "amazon_orders_history_pending_window_end";
const ORDERS_HISTORY_PENDING_AT_KEY = "amazon_orders_history_pending_report_at";
const LOJA_ABERTA_EM_KEY = "amazon_loja_aberta_em";
const LOJA_ABERTA_EM_DEFAULT = "2025-08-23T03:00:00.000Z";
const ORDERS_HISTORY_WINDOW_DAYS = 30;
const ORDERS_HISTORY_END_OFFSET_DAYS = 2;
const ORDERS_HISTORY_PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000;

async function getCfg(chave: string): Promise<string | null> {
  const row = await db.configuracaoSistema.findUnique({ where: { chave } });
  return row?.valor ?? null;
}

async function setCfg(chave: string, valor: string): Promise<void> {
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
}

async function delCfg(chave: string): Promise<void> {
  await db.configuracaoSistema
    .delete({ where: { chave } })
    .catch(() => undefined);
}

export async function syncOrdersHistoryReport(creds: SPAPICredentials) {
  const now = new Date();
  const endLimit = addDays(now, -ORDERS_HISTORY_END_OFFSET_DAYS);

  const lojaAbertaIso =
    (await getCfg(LOJA_ABERTA_EM_KEY)) ?? LOJA_ABERTA_EM_DEFAULT;
  const cursorIso = await getCfg(ORDERS_HISTORY_CURSOR_KEY);
  const cursor = new Date(cursorIso ?? lojaAbertaIso);

  if (!Number.isFinite(cursor.getTime())) {
    return {
      ok: false,
      mensagem: `Cursor inválido (${cursorIso ?? lojaAbertaIso})`,
    };
  }

  if (cursor >= endLimit) {
    return {
      ok: true,
      completo: true,
      mensagem: `Backfill completo. Cursor em ${cursor.toISOString()}.`,
    };
  }

  let pendingId = await getCfg(ORDERS_HISTORY_PENDING_KEY);
  const pendingAt = parseCfgDate(await getCfg(ORDERS_HISTORY_PENDING_AT_KEY));
  if (
    pendingId &&
    pendingAt &&
    now.getTime() - pendingAt.getTime() > ORDERS_HISTORY_PENDING_TIMEOUT_MS
  ) {
    await delCfg(ORDERS_HISTORY_PENDING_KEY);
    await delCfg(ORDERS_HISTORY_PENDING_END_KEY);
    await delCfg(ORDERS_HISTORY_PENDING_AT_KEY);
    pendingId = null;
  } else if (pendingId && !pendingAt) {
    await setCfg(ORDERS_HISTORY_PENDING_AT_KEY, now.toISOString());
  }
  const windowStart = cursor;
  const proposedEnd = addDays(windowStart, ORDERS_HISTORY_WINDOW_DAYS);
  const windowEnd = proposedEnd > endLimit ? endLimit : proposedEnd;

  const result = await stepReportLifecycle(creds, {
    pendingReportId: pendingId,
    reportType: ORDERS_HISTORY_REPORT_TYPE,
    dataStartTime: windowStart,
    dataEndTime: windowEnd,
  });

  if (result.status === "PENDING_NEW") {
    await setCfg(ORDERS_HISTORY_PENDING_KEY, result.reportId);
    await setCfg(ORDERS_HISTORY_PENDING_END_KEY, windowEnd.toISOString());
    await setCfg(ORDERS_HISTORY_PENDING_AT_KEY, now.toISOString());
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: result.reportId,
      janelaInicio: windowStart.toISOString(),
      janelaFim: windowEnd.toISOString(),
    };
  }

  if (result.status === "PENDING_PROCESSING") {
    return {
      ok: true,
      pending: true,
      reportId: result.reportId,
      status: result.processingStatus,
      mensagem: `Report ${result.reportId} ainda ${result.processingStatus}. Re-tentando em próximo slot.`,
    };
  }

  if (result.status === "FAILED") {
    await delCfg(ORDERS_HISTORY_PENDING_KEY);
    await delCfg(ORDERS_HISTORY_PENDING_END_KEY);
    await delCfg(ORDERS_HISTORY_PENDING_AT_KEY);
    return {
      ok: false,
      reportId: result.reportId,
      mensagem: `Report ${result.reportId} terminou em ${result.processingStatus}. Limpo para retry.`,
    };
  }

  // DONE
  const rows = parseAllOrdersTsv(result.buffer);
  const stats = await upsertOrdersHistoryRows(rows, creds.marketplaceId);

  const windowEndIso =
    result.report.dataEndTime ??
    (await getCfg(ORDERS_HISTORY_PENDING_END_KEY)) ??
    windowEnd.toISOString();
  await setCfg(
    ORDERS_HISTORY_CURSOR_KEY,
    new Date(windowEndIso).toISOString(),
  );
  await delCfg(ORDERS_HISTORY_PENDING_KEY);
  await delCfg(ORDERS_HISTORY_PENDING_END_KEY);
  await delCfg(ORDERS_HISTORY_PENDING_AT_KEY);

  return {
    ok: true,
    processado: true,
    reportId: result.reportId,
    janelaAte: windowEndIso,
    ...stats,
  };
}

async function upsertOrdersHistoryRows(
  rows: Awaited<ReturnType<typeof parseAllOrdersTsv>>,
  marketplaceFallback: string,
) {
  let criadas = 0;
  let atualizadas = 0;
  let ignoradas = 0;
  const cfgImpostoSimples = await getConfigImpostoSimples();
  const pedidosBrutos = await upsertRawOrdersHistoryRows(
    rows,
    marketplaceFallback,
  );

  // Pré-carrega produtos por SKU pra pegar custoUnitario e asin.
  const skus = Array.from(new Set(rows.map((r) => r.sku))).filter(Boolean);
  const produtos = skus.length
    ? await db.produto.findMany({
        where: { sku: { in: skus } },
        select: { sku: true, custoUnitario: true, asin: true },
      })
    : [];
  const produtosPorSku = new Map(produtos.map((p) => [p.sku, p]));

  const linhasValidas = rows.filter(
    (r) => r.amazonOrderId && r.sku && r.quantity > 0,
  );
  ignoradas += rows.length - linhasValidas.length;
  const linhasAgrupadas = agruparLinhasVendaAmazon(
    linhasValidas.map((r) => ({
      ...r,
      quantidade: r.quantity,
      valorBrutoCentavos: r.itemPriceCentavos,
      fretesCentavos: r.shippingPriceCentavos,
      taxasCentavos: r.itemTaxCentavos + r.shippingTaxCentavos,
      liquidoMarketplaceCentavos:
        r.itemPriceCentavos - (r.itemTaxCentavos + r.shippingTaxCentavos),
    })),
  );

  for (const r of linhasAgrupadas) {
    const produto = produtosPorSku.get(r.sku);
    // Provisório: o FINANCES_SYNC posterior refina taxasCentavos com fees Amazon reais.

    const where = {
      amazonOrderId_sku: { amazonOrderId: r.amazonOrderId, sku: r.sku },
    };
    const existente = await db.vendaAmazon.findUnique({ where });

    const statusFinanceiroFinal = existente?.statusFinanceiro ?? "PENDENTE";
    const impostoSimplesCentavos = calcularImpostoSimplesCentavos({
      valorBrutoCentavos: r.valorBrutoCentavos,
      aliquotaBps: cfgImpostoSimples.aliquotaBps,
      ativo: cfgImpostoSimples.ativo,
      statusPedido: r.orderStatus,
      statusFinanceiro: statusFinanceiroFinal,
    });

    const data = {
      asin: r.asin ?? produto?.asin ?? null,
      titulo: r.productName ?? null,
      quantidade: r.quantidade,
      precoUnitarioCentavos: r.precoUnitarioCentavos,
      valorBrutoCentavos: r.valorBrutoCentavos,
      taxasCentavos: existente?.taxasCentavos ?? r.taxasCentavos,
      fretesCentavos: existente?.fretesCentavos ?? r.fretesCentavos,
      liquidoMarketplaceCentavos:
        existente?.liquidoMarketplaceCentavos ?? r.liquidoMarketplaceCentavos,
      impostoSimplesCentavos,
      marketplace: r.salesChannel ?? marketplaceFallback,
      fulfillmentChannel: r.fulfillmentChannel,
      statusPedido: r.orderStatus,
      dataVenda: r.purchaseDate ?? existente?.dataVenda ?? new Date(),
      ultimaSyncEm: new Date(),
    };

    await db.vendaAmazon.upsert({
      where,
      update: data,
      create: {
        amazonOrderId: r.amazonOrderId,
        sku: r.sku,
        ...data,
        statusFinanceiro: statusFinanceiroFinal,
        custoUnitarioCentavos:
          produto?.custoUnitario && produto.custoUnitario > 0
            ? produto.custoUnitario
            : null,
      },
    });
    if (existente) atualizadas++;
    else criadas++;
  }

  return { linhas: rows.length, pedidosBrutos, criadas, atualizadas, ignoradas };
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 2: FINANCES_BACKFILL — backfill de Finances API listTransactions
// Cursor-based, janela de 14d, salva transações brutas em
// AmazonFinanceTransaction com payload completo. Auto-desliga ao alcançar
// `now - 2 dias`.
// ─────────────────────────────────────────────────────────────────────

async function upsertRawOrdersHistoryRows(
  rows: Awaited<ReturnType<typeof parseAllOrdersTsv>>,
  marketplaceFallback: string,
) {
  const porPedido = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.amazonOrderId) continue;
    const group = porPedido.get(row.amazonOrderId) ?? [];
    group.push(row);
    porPedido.set(row.amazonOrderId, group);
  }

  for (const [amazonOrderId, group] of porPedido) {
    const first = group[0];
    if (!first) continue;

    const statusPedido =
      group.find((row) => row.orderStatus && row.orderStatus !== "UNKNOWN")
        ?.orderStatus ?? "UNKNOWN";
    const itensProcessados = group.some((row) => !!row.sku && row.quantity > 0);
    const data = {
      statusPedido,
      createdTime: first.purchaseDate,
      marketplaceId: first.salesChannel ?? marketplaceFallback,
      fulfillmentChannel: first.fulfillmentChannel,
      payloadJson: JSON.stringify({
        source: ORDERS_HISTORY_REPORT_TYPE,
        rows: group,
      }),
      ultimaSyncEm: new Date(),
    };

    await db.amazonOrderRaw.upsert({
      where: { amazonOrderId },
      create: {
        amazonOrderId,
        ...data,
        lastUpdatedTime: null,
        itensProcessados,
      },
      update: {
        ...data,
        ...(itensProcessados ? { itensProcessados: true } : {}),
      },
    });
  }

  return porPedido.size;
}

const FINANCES_BACKFILL_CURSOR_KEY = "amazon_finances_backfill_cursor";
const FINANCES_BACKFILL_WINDOW_DAYS = 14;
const FINANCES_BACKFILL_END_OFFSET_DAYS = 2;
const FINANCES_BACKFILL_MAX_PAGES = 20;

export async function runFinancesBackfill(creds: SPAPICredentials) {
  const now = new Date();
  const endLimit = addDays(now, -FINANCES_BACKFILL_END_OFFSET_DAYS);

  const lojaAbertaIso =
    (await getCfg(LOJA_ABERTA_EM_KEY)) ?? LOJA_ABERTA_EM_DEFAULT;
  const cursorIso = await getCfg(FINANCES_BACKFILL_CURSOR_KEY);
  const cursor = new Date(cursorIso ?? lojaAbertaIso);

  if (!Number.isFinite(cursor.getTime())) {
    return {
      ok: false,
      mensagem: `Cursor inválido (${cursorIso ?? lojaAbertaIso})`,
    };
  }
  if (cursor >= endLimit) {
    return {
      ok: true,
      completo: true,
      mensagem: `Backfill financeiro completo. Cursor em ${cursor.toISOString()}.`,
    };
  }

  const windowStart = cursor;
  const proposedEnd = addDays(windowStart, FINANCES_BACKFILL_WINDOW_DAYS);
  const windowEnd = proposedEnd > endLimit ? endLimit : proposedEnd;

  const transactions = await listFinancialTransactions(
    creds,
    windowStart,
    windowEnd,
    100,
    { maxPages: FINANCES_BACKFILL_MAX_PAGES },
  );

  const stats = await upsertAmazonFinanceTransactions(transactions, {
    materializarReembolsos: shouldAutoApplyAmazonRefunds(),
  });

  await setCfg(FINANCES_BACKFILL_CURSOR_KEY, windowEnd.toISOString());

  return {
    ok: true,
    janelaInicio: windowStart.toISOString(),
    janelaFim: windowEnd.toISOString(),
    transacoes: transactions.length,
    ...stats,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 2: SETTLEMENT_BACKFILL — backfill de relatórios de liquidação
// Cursor-based, janela de 60d (settlements ~14d cada → ~4 reports/janela).
// Auto-desliga ao alcançar `now - 2 dias`.
// ─────────────────────────────────────────────────────────────────────

const SETTLEMENT_BACKFILL_CURSOR_KEY = "amazon_settlement_backfill_cursor";
const SETTLEMENT_BACKFILL_WINDOW_DAYS = 60;
const SETTLEMENT_BACKFILL_END_OFFSET_DAYS = 2;
const SETTLEMENT_BACKFILL_MAX_PAGES_PER_WINDOW = 1;

export async function runSettlementBackfill(creds: SPAPICredentials) {
  const now = new Date();
  const endLimit = addDays(now, -SETTLEMENT_BACKFILL_END_OFFSET_DAYS);

  const lojaAbertaIso =
    (await getCfg(LOJA_ABERTA_EM_KEY)) ?? LOJA_ABERTA_EM_DEFAULT;
  const cursorIso = await getCfg(SETTLEMENT_BACKFILL_CURSOR_KEY);
  const cursor = new Date(cursorIso ?? lojaAbertaIso);

  if (!Number.isFinite(cursor.getTime())) {
    return {
      ok: false,
      mensagem: `Cursor inválido (${cursorIso ?? lojaAbertaIso})`,
    };
  }
  if (cursor >= endLimit) {
    return {
      ok: true,
      completo: true,
      mensagem: `Backfill de settlements completo. Cursor em ${cursor.toISOString()}.`,
    };
  }

  // Settlement reports API rejeita createdSince > 90 dias. Se o cursor estiver
  // antes disso, avançamos direto para o limite aceitável e atualizamos o cursor.
  const apiLimit = addDays(now, -89);
  const windowStart = cursor < apiLimit ? apiLimit : cursor;
  if (cursor < apiLimit) {
    await setCfg(SETTLEMENT_BACKFILL_CURSOR_KEY, windowStart.toISOString());
  }
  const proposedEnd = addDays(windowStart, SETTLEMENT_BACKFILL_WINDOW_DAYS);
  const windowEnd = proposedEnd > endLimit ? endLimit : proposedEnd;

  const reports = await getSettlementReports(
    creds,
    SETTLEMENT_BACKFILL_MAX_PAGES_PER_WINDOW,
    { createdSince: windowStart, createdUntil: windowEnd },
  );

  let baixados = 0;
  let novos = 0;
  let erros = 0;

  for (const report of reports) {
    if (!report.reportDocumentId) continue;
    if (!report.reportType || !SETTLEMENT_TYPES.includes(report.reportType))
      continue;
    if (report.processingStatus && report.processingStatus !== "DONE") continue;

    const existente = await db.amazonSettlementReport.findUnique({
      where: { reportId: report.reportId },
    });
    if (existente?.processadoEm) continue;

    try {
      const lifecycle = await stepReportLifecycle(creds, {
        pendingReportId: report.reportId,
        reportType: report.reportType,
      });
      if (lifecycle.status !== "DONE") {
        erros++;
        continue;
      }
      const csvBuffer = lifecycle.buffer;
      const resumo = await contasReceberService.importarAmazonCSV(csvBuffer);
      baixados++;

      const settlementId = resumo.liquidacoes[0]?.liquidacaoId ?? null;
      const valorTotal = resumo.liquidacoes.reduce(
        (s, l) => s + l.totalLiquidoCentavos,
        0,
      );

      await db.amazonSettlementReport.upsert({
        where: { reportId: report.reportId },
        create: {
          reportId: report.reportId,
          reportDocumentId: report.reportDocumentId,
          settlementId,
          totalAmountCentavos: valorTotal,
          processadoEm: new Date(),
          contasGeradas: resumo.liquidacoes.length,
        },
        update: {
          reportDocumentId: report.reportDocumentId,
          settlementId,
          totalAmountCentavos: valorTotal,
          processadoEm: new Date(),
          contasGeradas: resumo.liquidacoes.length,
        },
      });
      novos++;
      break;
    } catch (err) {
      console.warn("settlement-backfill erro:", err);
      erros++;
    }
  }

  await setCfg(SETTLEMENT_BACKFILL_CURSOR_KEY, windowEnd.toISOString());

  return {
    ok: true,
    janelaInicio: windowStart.toISOString(),
    janelaFim: windowEnd.toISOString(),
    reports: reports.length,
    baixados,
    novos,
    erros,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sprint 2: INVENTORY_SNAPSHOT — snapshot diário de inventário FBA por SKU
// Histórico não volta pela API. Roda 24h, cria 1 row/SKU/dia (idempotente
// via @@unique([sku, dataSnapshot])).
// ─────────────────────────────────────────────────────────────────────

export async function runInventorySnapshot(creds: SPAPICredentials) {
  const summaries = await getInventorySummaries(creds);
  const today = startOfUTCDay(new Date());

  // Pré-carrega Produto.id por SKU para preencher FK.
  const skus = Array.from(
    new Set(summaries.map((s) => s.sellerSku).filter(Boolean) as string[]),
  );
  const produtos = skus.length
    ? await db.produto.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true },
      })
    : [];
  const produtoIdPorSku = new Map(produtos.map((p) => [p.sku, p.id]));

  let salvos = 0;
  let ignorados = 0;

  for (const s of summaries) {
    if (!s.sellerSku) {
      ignorados++;
      continue;
    }
    const fulfillable = s.inventoryDetails?.fulfillableQuantity ?? 0;
    const inboundWorking = s.inventoryDetails?.inboundWorkingQuantity ?? 0;
    const reserved =
      s.inventoryDetails?.reservedQuantity?.totalReservedQuantity ?? 0;
    const total = s.totalQuantity ?? 0;

    const data = {
      asin: s.asin ?? null,
      fnSku: s.fnSku ?? null,
      fulfillableQuantity: fulfillable,
      inboundWorkingQuantity: inboundWorking,
      reservedQuantity: reserved,
      totalQuantity: total,
      produtoId: produtoIdPorSku.get(s.sellerSku) ?? null,
    };

    await db.inventorySnapshot.upsert({
      where: {
        sku_dataSnapshot: { sku: s.sellerSku, dataSnapshot: today },
      },
      create: { sku: s.sellerSku, dataSnapshot: today, ...data },
      update: data,
    });
    salvos++;
  }

  return {
    ok: true,
    snapshots: summaries.length,
    salvos,
    ignorados,
    dataSnapshot: today.toISOString(),
  };
}

function startOfUTCDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sprint 3: FBA reimbursements, returns, storage fees e Sales & Traffic.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FBA_REIMBURSEMENTS_REPORT_TYPE = "GET_FBA_REIMBURSEMENTS_DATA";
const FBA_RETURNS_REPORT_TYPE = "GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA";
const FBA_STORAGE_REPORT_TYPE = "GET_FBA_STORAGE_FEE_CHARGES_DATA";
const SALES_TRAFFIC_REPORT_TYPE = "GET_SALES_AND_TRAFFIC_REPORT";

const REIMBURSEMENTS_PENDING_KEY = "amazon_fba_reimbursements_pending_report_id";
const REIMBURSEMENTS_PENDING_START_KEY = "amazon_fba_reimbursements_pending_start";
const REIMBURSEMENTS_PENDING_END_KEY = "amazon_fba_reimbursements_pending_end";
const RETURNS_PENDING_KEY = "amazon_returns_pending_report_id";
const RETURNS_PENDING_START_KEY = "amazon_returns_pending_start";
const RETURNS_PENDING_END_KEY = "amazon_returns_pending_end";
const STORAGE_PENDING_KEY = "amazon_storage_pending_report_id";
const STORAGE_PENDING_MONTH_KEY = "amazon_storage_pending_month";
const STORAGE_LAST_MONTH_KEY = "amazon_storage_last_processed_month";
const TRAFFIC_PENDING_KEY = "amazon_traffic_pending_report_id";
const TRAFFIC_PENDING_START_KEY = "amazon_traffic_pending_start";
const TRAFFIC_PENDING_END_KEY = "amazon_traffic_pending_end";
const DEFAULT_REIMBURSEMENT_THRESHOLD_CENTAVOS = 10_000;

type Sprint3Payload = {
  diasAtras?: number;
};

export async function runFbaReimbursementsSync(
  creds: SPAPICredentials,
  payload: Sprint3Payload = {},
) {
  const end = new Date();
  const start = addDays(end, -(payload.diasAtras ?? 90));
  const pendingId = await getCfg(REIMBURSEMENTS_PENDING_KEY);
  const lifecycle = await stepReportLifecycle(creds, {
    pendingReportId: pendingId,
    reportType: FBA_REIMBURSEMENTS_REPORT_TYPE,
    dataStartTime: start,
    dataEndTime: end,
  });

  if (lifecycle.status === "PENDING_NEW") {
    await setCfg(REIMBURSEMENTS_PENDING_KEY, lifecycle.reportId);
    await setCfg(REIMBURSEMENTS_PENDING_START_KEY, start.toISOString());
    await setCfg(REIMBURSEMENTS_PENDING_END_KEY, end.toISOString());
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: lifecycle.reportId,
      reportType: FBA_REIMBURSEMENTS_REPORT_TYPE,
    };
  }

  if (lifecycle.status === "PENDING_PROCESSING") {
    return {
      ok: true,
      pending: true,
      reportId: lifecycle.reportId,
      status: lifecycle.processingStatus,
    };
  }

  if (lifecycle.status === "FAILED") {
    await clearReportKeys(
      REIMBURSEMENTS_PENDING_KEY,
      REIMBURSEMENTS_PENDING_START_KEY,
      REIMBURSEMENTS_PENDING_END_KEY,
    );
    if (lifecycle.processingStatus === "NO_URL" || lifecycle.processingStatus === "NO_DOCUMENT") {
      return { ok: true, reportId: lifecycle.reportId, linhas: 0, criadas: 0, atualizadas: 0, semDados: true };
    }
    throw new Error(
      `Report ${FBA_REIMBURSEMENTS_REPORT_TYPE} ${lifecycle.reportId} terminou em ${lifecycle.processingStatus}`,
    );
  }

  const rows = parseFbaReimbursementsTsv(lifecycle.buffer);
  const stats = await upsertFbaReimbursements(rows, lifecycle.reportId);
  await clearReportKeys(
    REIMBURSEMENTS_PENDING_KEY,
    REIMBURSEMENTS_PENDING_START_KEY,
    REIMBURSEMENTS_PENDING_END_KEY,
  );
  return {
    ok: true,
    reportId: lifecycle.reportId,
    linhas: rows.length,
    ...stats,
  };
}

export async function runReturnsSync(
  creds: SPAPICredentials,
  payload: Sprint3Payload = {},
) {
  const end = new Date();
  const start = addDays(end, -(payload.diasAtras ?? 90));
  const pendingId = await getCfg(RETURNS_PENDING_KEY);
  const lifecycle = await stepReportLifecycle(creds, {
    pendingReportId: pendingId,
    reportType: FBA_RETURNS_REPORT_TYPE,
    dataStartTime: start,
    dataEndTime: end,
  });

  if (lifecycle.status === "PENDING_NEW") {
    await setCfg(RETURNS_PENDING_KEY, lifecycle.reportId);
    await setCfg(RETURNS_PENDING_START_KEY, start.toISOString());
    await setCfg(RETURNS_PENDING_END_KEY, end.toISOString());
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: lifecycle.reportId,
      reportType: FBA_RETURNS_REPORT_TYPE,
    };
  }

  if (lifecycle.status === "PENDING_PROCESSING") {
    return {
      ok: true,
      pending: true,
      reportId: lifecycle.reportId,
      status: lifecycle.processingStatus,
    };
  }

  if (lifecycle.status === "FAILED") {
    await clearReportKeys(
      RETURNS_PENDING_KEY,
      RETURNS_PENDING_START_KEY,
      RETURNS_PENDING_END_KEY,
    );
    if (lifecycle.processingStatus === "NO_URL" || lifecycle.processingStatus === "NO_DOCUMENT") {
      return { ok: true, reportId: lifecycle.reportId, linhas: 0, criadas: 0, atualizadas: 0, semDados: true };
    }
    throw new Error(
      `Report ${FBA_RETURNS_REPORT_TYPE} ${lifecycle.reportId} terminou em ${lifecycle.processingStatus}`,
    );
  }

  const rows = parseFbaReturnsTsv(lifecycle.buffer);
  const stats = await upsertReturns(rows, lifecycle.reportId);
  await clearReportKeys(
    RETURNS_PENDING_KEY,
    RETURNS_PENDING_START_KEY,
    RETURNS_PENDING_END_KEY,
  );
  return {
    ok: true,
    reportId: lifecycle.reportId,
    linhas: rows.length,
    ...stats,
  };
}

export async function runFbaStorageFeesSync(creds: SPAPICredentials) {
  const month = startOfUTCMonth(addDays(new Date(), -31));
  const monthIso = month.toISOString();
  const lastProcessed = await getCfg(STORAGE_LAST_MONTH_KEY);
  const pendingId = await getCfg(STORAGE_PENDING_KEY);

  if (!pendingId && lastProcessed === monthIso) {
    return {
      ok: true,
      completo: true,
      monthOfCharge: monthIso,
      mensagem: "Storage fees do ultimo mes ja processadas.",
    };
  }

  const lifecycle = await stepReportLifecycle(creds, {
    pendingReportId: pendingId,
    reportType: FBA_STORAGE_REPORT_TYPE,
    dataStartTime: month,
    dataEndTime: addMonthsUTC(month, 1),
  });

  if (lifecycle.status === "PENDING_NEW") {
    await setCfg(STORAGE_PENDING_KEY, lifecycle.reportId);
    await setCfg(STORAGE_PENDING_MONTH_KEY, monthIso);
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: lifecycle.reportId,
      monthOfCharge: monthIso,
      reportType: FBA_STORAGE_REPORT_TYPE,
    };
  }

  if (lifecycle.status === "PENDING_PROCESSING") {
    return {
      ok: true,
      pending: true,
      reportId: lifecycle.reportId,
      status: lifecycle.processingStatus,
    };
  }

  if (lifecycle.status === "FAILED") {
    await clearReportKeys(STORAGE_PENDING_KEY, STORAGE_PENDING_MONTH_KEY);
    if (lifecycle.processingStatus === "NO_URL" || lifecycle.processingStatus === "NO_DOCUMENT") {
      return { ok: true, reportId: lifecycle.reportId, linhas: 0, criadas: 0, atualizadas: 0, semDados: true };
    }
    throw new Error(
      `Report ${FBA_STORAGE_REPORT_TYPE} ${lifecycle.reportId} terminou em ${lifecycle.processingStatus}`,
    );
  }

  const fallbackMonth =
    parseCfgDate(await getCfg(STORAGE_PENDING_MONTH_KEY)) ?? month;
  const rows = parseFbaStorageFeesTsv(lifecycle.buffer);
  const stats = await upsertStorageFees(rows, lifecycle.reportId, fallbackMonth);
  await setCfg(STORAGE_LAST_MONTH_KEY, fallbackMonth.toISOString());
  await clearReportKeys(STORAGE_PENDING_KEY, STORAGE_PENDING_MONTH_KEY);
  return {
    ok: true,
    reportId: lifecycle.reportId,
    monthOfCharge: fallbackMonth.toISOString(),
    linhas: rows.length,
    ...stats,
  };
}

export async function runTrafficSync(
  creds: SPAPICredentials,
  payload: Sprint3Payload = {},
) {
  const end = new Date();
  const start = addDays(end, -(payload.diasAtras ?? 30));
  const pendingId = await getCfg(TRAFFIC_PENDING_KEY);
  const pendingStart = parseCfgDate(await getCfg(TRAFFIC_PENDING_START_KEY)) ?? start;

  const lifecycle = await stepReportLifecycle(creds, {
    pendingReportId: pendingId,
    reportType: SALES_TRAFFIC_REPORT_TYPE,
    dataStartTime: pendingId ? pendingStart : start,
    dataEndTime: pendingId
      ? parseCfgDate(await getCfg(TRAFFIC_PENDING_END_KEY)) ?? end
      : end,
    reportOptions: {
      dateGranularity: "DAY",
      asinGranularity: "SKU",
    },
  });

  if (lifecycle.status === "PENDING_NEW") {
    await setCfg(TRAFFIC_PENDING_KEY, lifecycle.reportId);
    await setCfg(TRAFFIC_PENDING_START_KEY, start.toISOString());
    await setCfg(TRAFFIC_PENDING_END_KEY, end.toISOString());
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: lifecycle.reportId,
      de: start.toISOString(),
      ate: end.toISOString(),
      reportType: SALES_TRAFFIC_REPORT_TYPE,
    };
  }

  if (lifecycle.status === "PENDING_PROCESSING") {
    return {
      ok: true,
      pending: true,
      reportId: lifecycle.reportId,
      status: lifecycle.processingStatus,
    };
  }

  if (lifecycle.status === "FAILED") {
    await clearReportKeys(
      TRAFFIC_PENDING_KEY,
      TRAFFIC_PENDING_START_KEY,
      TRAFFIC_PENDING_END_KEY,
    );
    if (lifecycle.processingStatus === "NO_URL" || lifecycle.processingStatus === "NO_DOCUMENT") {
      return { ok: true, reportId: lifecycle.reportId, linhas: 0, criadas: 0, atualizadas: 0, semDados: true };
    }
    throw new Error(
      `Report ${SALES_TRAFFIC_REPORT_TYPE} ${lifecycle.reportId} terminou em ${lifecycle.processingStatus}`,
    );
  }

  const fallbackDate = pendingStart ?? start;
  const rows = parseSalesTrafficJson(lifecycle.buffer, fallbackDate);
  const stats = await upsertTrafficRows(rows);
  await clearReportKeys(
    TRAFFIC_PENDING_KEY,
    TRAFFIC_PENDING_START_KEY,
    TRAFFIC_PENDING_END_KEY,
  );
  return {
    ok: true,
    reportId: lifecycle.reportId,
    de: fallbackDate.toISOString(),
    ate: end.toISOString(),
    linhas: rows.length,
    ...stats,
  };
}

async function upsertFbaReimbursements(
  rows: ReturnType<typeof parseFbaReimbursementsTsv>,
  reportId: string,
) {
  const lookup = await loadProdutoLookup(
    rows.map((r) => r.sku).filter(Boolean) as string[],
    rows.map((r) => r.asin).filter(Boolean) as string[],
  );
  const threshold = await getReimbursementThreshold();
  let criadas = 0;
  let atualizadas = 0;
  let notificadas = 0;

  for (const row of rows) {
    const produtoId = findProdutoId(lookup, row.sku, row.asin);
    const data = {
      reportId,
      reimbursementId: row.reimbursementId,
      caseId: row.caseId,
      amazonOrderId: row.amazonOrderId,
      approvalDate: row.approvalDate,
      sku: row.sku,
      fnSku: row.fnSku,
      asin: row.asin,
      productName: row.productName,
      reason: row.reason,
      condition: row.condition,
      currency: row.currency,
      amountPerUnitCentavos: row.amountPerUnitCentavos,
      amountTotalCentavos: row.amountTotalCentavos,
      quantityCash: row.quantityCash,
      quantityInventory: row.quantityInventory,
      quantityTotal: row.quantityTotal,
      originalReimbursementId: row.originalReimbursementId,
      originalReimbursementType: row.originalReimbursementType,
      produtoId,
      payloadJson: JSON.stringify(row.payload),
    };

    const existing = await db.amazonReimbursement.findUnique({
      where: { naturalKey: row.naturalKey },
    });
    if (existing) {
      await db.amazonReimbursement.update({
        where: { naturalKey: row.naturalKey },
        data,
      });
      atualizadas++;
    } else {
      await db.amazonReimbursement.create({
        data: { naturalKey: row.naturalKey, ...data },
      });
      criadas++;
      if (row.amountTotalCentavos >= threshold) {
        await notificarReimbursementFbaRecebido({
          naturalKey: row.naturalKey,
          sku: row.sku,
          valor: row.amountTotalCentavos,
          motivo: row.reason,
        });
        notificadas++;
      }
    }
  }

  return { criadas, atualizadas, notificadas };
}

async function upsertReturns(
  rows: ReturnType<typeof parseFbaReturnsTsv>,
  reportId: string,
) {
  const lookup = await loadProdutoLookup(
    rows.map((r) => r.sku).filter(Boolean) as string[],
    rows.map((r) => r.asin).filter(Boolean) as string[],
  );
  const estimativas = await estimateReturnsValue(rows);
  let criadas = 0;
  let atualizadas = 0;

  for (const row of rows) {
    const produtoId = findProdutoId(lookup, row.sku, row.asin);
    const data = {
      reportId,
      tipoReport: row.tipoReport,
      returnDate: row.returnDate,
      amazonOrderId: row.amazonOrderId,
      sku: row.sku,
      fnSku: row.fnSku,
      asin: row.asin,
      productName: row.productName,
      quantity: row.quantity,
      fulfillmentCenterId: row.fulfillmentCenterId,
      detailedDisposition: row.detailedDisposition,
      reason: row.reason,
      status: row.status,
      licensePlateNumber: row.licensePlateNumber,
      customerComments: row.customerComments,
      valorEstimadoCentavos: estimativas.get(row.naturalKey) ?? null,
      produtoId,
      payloadJson: JSON.stringify(row.payload),
    };

    const existing = await db.amazonReturn.findUnique({
      where: { naturalKey: row.naturalKey },
    });
    if (existing) {
      await db.amazonReturn.update({
        where: { naturalKey: row.naturalKey },
        data,
      });
      atualizadas++;
    } else {
      await db.amazonReturn.create({
        data: { naturalKey: row.naturalKey, ...data },
      });
      criadas++;
    }
  }

  return { criadas, atualizadas };
}

async function upsertStorageFees(
  rows: ReturnType<typeof parseFbaStorageFeesTsv>,
  reportId: string,
  fallbackMonth: Date,
) {
  let criadas = 0;
  let atualizadas = 0;

  for (const row of rows) {
    const monthOfCharge = row.monthOfCharge ?? fallbackMonth;
    const data = {
      reportId,
      asin: row.asin,
      fnSku: row.fnSku,
      productName: row.productName,
      fulfillmentCenter: row.fulfillmentCenter,
      countryCode: row.countryCode,
      monthOfCharge,
      storageRate: row.storageRate,
      currency: row.currency,
      averageQuantityOnHand: row.averageQuantityOnHand,
      averageQuantityPendingRemoval: row.averageQuantityPendingRemoval,
      estimatedTotalItemVolume: row.estimatedTotalItemVolume,
      itemVolume: row.itemVolume,
      volumeUnits: row.volumeUnits,
      productSizeTier: row.productSizeTier,
      storageFeeCentavos: row.storageFeeCentavos,
      dangerousGoodsStorageType: row.dangerousGoodsStorageType,
      payloadJson: JSON.stringify(row.payload),
    };

    const existing = await db.amazonStorageFee.findUnique({
      where: { naturalKey: row.naturalKey },
    });
    if (existing) {
      await db.amazonStorageFee.update({
        where: { naturalKey: row.naturalKey },
        data,
      });
      atualizadas++;
    } else {
      await db.amazonStorageFee.create({
        data: { naturalKey: row.naturalKey, ...data },
      });
      criadas++;
    }
  }

  return { criadas, atualizadas };
}

async function upsertTrafficRows(
  rows: ReturnType<typeof parseSalesTrafficJson>,
) {
  const lookup = await loadProdutoLookup(
    rows.map((r) => r.sku),
    rows.map((r) => r.childAsin).filter(Boolean) as string[],
  );
  let criadas = 0;
  let atualizadas = 0;

  for (const row of rows) {
    const produtoId = findProdutoId(lookup, row.sku, row.childAsin);
    const data = {
      parentAsin: row.parentAsin,
      childAsin: row.childAsin,
      sessoes: row.sessoes,
      pageViews: row.pageViews,
      unitsOrdered: row.unitsOrdered,
      buyBoxPercent: row.buyBoxPercent,
      conversaoPercent: row.conversaoPercent,
      orderedRevenueCentavos: row.orderedRevenueCentavos,
      currency: row.currency,
      produtoId,
      payloadJson: JSON.stringify(row.payload),
    };
    const existing = await db.amazonSkuTrafficDaily.findUnique({
      where: { sku_data: { sku: row.sku, data: row.data } },
    });
    if (existing) {
      await db.amazonSkuTrafficDaily.update({
        where: { sku_data: { sku: row.sku, data: row.data } },
        data,
      });
      atualizadas++;
    } else {
      await db.amazonSkuTrafficDaily.create({
        data: {
          sku: row.sku,
          data: row.data,
          ...data,
        },
      });
      criadas++;
    }
  }

  return { criadas, atualizadas };
}

async function loadProdutoLookup(skus: string[], asins: string[]) {
  const cleanSkus = Array.from(new Set(skus.filter(Boolean)));
  const cleanAsins = Array.from(new Set(asins.filter(Boolean)));
  if (cleanSkus.length === 0 && cleanAsins.length === 0) {
    return { bySku: new Map<string, string>(), byAsin: new Map<string, string>() };
  }

  const produtos = await db.produto.findMany({
    where: {
      OR: [
        ...(cleanSkus.length ? [{ sku: { in: cleanSkus } }] : []),
        ...(cleanAsins.length ? [{ asin: { in: cleanAsins } }] : []),
      ],
    },
    select: { id: true, sku: true, asin: true },
  });

  return {
    bySku: new Map(produtos.map((p) => [p.sku, p.id])),
    byAsin: new Map(
      produtos
        .filter((p) => p.asin)
        .map((p) => [p.asin as string, p.id]),
    ),
  };
}

function findProdutoId(
  lookup: Awaited<ReturnType<typeof loadProdutoLookup>>,
  sku?: string | null,
  asin?: string | null,
): string | null {
  return (sku ? lookup.bySku.get(sku) : null) ?? (asin ? lookup.byAsin.get(asin) : null) ?? null;
}

async function estimateReturnsValue(rows: ReturnType<typeof parseFbaReturnsTsv>) {
  const keys = rows
    .filter((r) => r.amazonOrderId && r.sku)
    .map((r) => ({ amazonOrderId: r.amazonOrderId!, sku: r.sku! }));

  const estimativas = new Map<string, number>();
  if (keys.length === 0) return estimativas;

  const vendas = await db.vendaAmazon.findMany({
    where: {
      OR: keys.map((key) => ({
        amazonOrderId: key.amazonOrderId,
        sku: key.sku,
      })),
    },
    select: {
      amazonOrderId: true,
      sku: true,
      precoUnitarioCentavos: true,
    },
  });
  const vendaPorChave = new Map(
    vendas.map((v) => [`${v.amazonOrderId}|${v.sku}`, v.precoUnitarioCentavos]),
  );

  for (const row of rows) {
    if (!row.amazonOrderId || !row.sku) continue;
    const preco = vendaPorChave.get(`${row.amazonOrderId}|${row.sku}`);
    if (preco == null) continue;
    estimativas.set(row.naturalKey, preco * Math.max(1, row.quantity));
  }

  return estimativas;
}

async function getReimbursementThreshold() {
  const fromEnv = Number(process.env.AMAZON_REIMBURSEMENT_FBA_NOTIFY_THRESHOLD_CENTAVOS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const cfg = await getCfg("amazon_reimbursement_fba_notify_threshold_centavos");
  const fromCfg = Number(cfg);
  return Number.isFinite(fromCfg) && fromCfg > 0
    ? fromCfg
    : DEFAULT_REIMBURSEMENT_THRESHOLD_CENTAVOS;
}

async function clearReportKeys(...keys: string[]) {
  await Promise.all(keys.map((key) => delCfg(key)));
}

function parseCfgDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function startOfUTCMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonthsUTC(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

// ─────────────────────────────────────────────────────────────────────
// LISTING_PRICE_SYNC
// ─────────────────────────────────────────────────────────────────────
// Sincroniza o preco efetivo do listing (discounted_price ativo, ou our_price)
// para cada SKU ativo. Salva em Produto.amazonPrecoListagemCentavos. Usado como
// fallback de valorBrutoCentavos quando a Orders API ainda nao retorna ItemPrice.
//
// Rate limit LISTINGS_GET_ITEM = 5 rps, burst 10. Lotamos em 100 SKUs por
// execução (suficiente para inventário típico < 200 ativos); o restante
// pega no próximo ciclo via rotação por `amazonPrecoListagemSyncEm asc`.

const LISTING_PRICE_BATCH_SIZE = 100;

export async function runListingPriceSync(creds: SPAPICredentials) {
  let sellerId: string | null = null;
  const sellerIdRow = await db.configuracaoSistema.findUnique({
    where: { chave: "amazon_seller_id" },
  });
  sellerId = sellerIdRow?.valor ?? null;
  // Auto-descobre via SP-API se ainda nao estiver salvo (rota Sellers/v1).
  if (!sellerId) {
    try {
      sellerId = await getSellerId(creds);
      if (sellerId) {
        await db.configuracaoSistema.upsert({
          where: { chave: "amazon_seller_id" },
          create: { chave: "amazon_seller_id", valor: sellerId },
          update: { valor: sellerId },
        });
      }
    } catch (err) {
      return {
        ok: false,
        skipped: true,
        mensagem: `Falha ao resolver amazon_seller_id: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!sellerId) {
    return {
      ok: false,
      skipped: true,
      mensagem: "amazon_seller_id nao disponivel (SP-API retornou vazio).",
    };
  }

  // Rotaciona por menor sincronia primeiro; SKUs novos (sync null) entram
  // primeiro graças ao `nulls first`.
  const produtos = await db.produto.findMany({
    where: { ativo: true },
    orderBy: [{ amazonPrecoListagemSyncEm: { sort: "asc", nulls: "first" } }],
    take: LISTING_PRICE_BATCH_SIZE,
    select: { id: true, sku: true },
  });

  let atualizados = 0;
  let semPreco = 0;
  const erros: string[] = [];

  for (const p of produtos) {
    try {
      const item = await getListingsItem(creds, sellerId, p.sku);
      const preco = extractAmazonListingEffectivePriceCentavos(item);
      await db.produto.update({
        where: { id: p.id },
        data: {
          amazonPrecoListagemCentavos: preco,
          amazonPrecoListagemSyncEm: new Date(),
        },
      });
      if (preco == null) semPreco++;
      else atualizados++;
    } catch (err) {
      erros.push(`${p.sku}: ${err instanceof Error ? err.message : String(err)}`);
      // Mesmo no erro, registra a tentativa pra não travar o SKU como sempre primeiro
      await db.produto.update({
        where: { id: p.id },
        data: { amazonPrecoListagemSyncEm: new Date() },
      });
    }
  }

  return { ok: true, processados: produtos.length, atualizados, semPreco, erros };
}

// ─────────────────────────────────────────────────────────────────────
// AMAZON_FEE_ESTIMATE_SYNC: chama SP-API getMyFeesEstimateForSKU para
// produtos ativos, salva em AmazonFeeEstimate. Roda 24h.
// ─────────────────────────────────────────────────────────────────────

// Amazon enforces PRODUCT_FEES_ESTIMATE mais agressivo que o documentado (1 rps).
// Reduzimos batch para 5 SKUs por execucao (rotaciona pelos produtos mais antigos).
// 5 SKUs × 4 execucoes/dia = 20 SKUs/dia, cobrindo a loja em 1-2 dias.
const FEE_ESTIMATE_MAX_PER_RUN = 5;
// Delay entre chamadas para nao acumular cooldown.
const FEE_ESTIMATE_DELAY_MS = 3000;

export async function runAmazonFeeEstimateSync(creds: SPAPICredentials) {
  // Usa cache em ConfiguracaoSistema.amazon_seller_id (povoado por
  // scripts/sync-seller-id.ts). Evita estourar rate limit SELLERS_GET
  // (0.016 rps = 1 req/60s) quando este job concorre com outros.
  const sellerIdCfg = await db.configuracaoSistema.findUnique({
    where: { chave: "amazon_seller_id" },
  });
  let sellerId = sellerIdCfg?.valor ?? null;
  if (!sellerId) {
    sellerId = await getSellerId(creds);
  }
  if (!sellerId) {
    return { ok: false, mensagem: "sellerId nao disponivel — pulando." };
  }

  const produtos = await db.produto.findMany({
    where: {
      ativo: true,
      sku: { not: "" },
      amazonPrecoListagemCentavos: { gt: 0 },
    },
    select: {
      id: true,
      sku: true,
      amazonPrecoListagemCentavos: true,
      feeEstimate: { select: { atualizadoEm: true } },
    },
    orderBy: { amazonUltimaSyncEm: "asc" },
  });

  const limiteRecente = new Date(Date.now() - 20 * 60 * 60_000);
  const filaProduto = produtos.filter(
    (p) => !p.feeEstimate || p.feeEstimate.atualizadoEm < limiteRecente,
  );
  const alvos = filaProduto.slice(0, FEE_ESTIMATE_MAX_PER_RUN);

  let okCount = 0;
  let erros = 0;
  for (let i = 0; i < alvos.length; i++) {
    const p = alvos[i];
    if (!p) continue;
    if (i > 0) {
      await new Promise((r) => setTimeout(r, FEE_ESTIMATE_DELAY_MS));
    }
    const preco = p.amazonPrecoListagemCentavos ?? 0;
    if (preco <= 0) continue;
    const est = await getMyFeesEstimateForSKU(creds, sellerId, p.sku, preco);
    if (!est?.feeDetailList) {
      erros += 1;
      continue;
    }

    let comissaoCentavos = 0;
    let fbaCentavos = 0;
    for (const f of est.feeDetailList) {
      const amt = f.finalFee?.amount ?? f.feeAmount?.amount ?? 0;
      const centavos = Math.round(amt * 100);
      if (f.feeType === "ReferralFee" || f.feeType === "VariableClosingFee") {
        comissaoCentavos += centavos;
      } else if (f.feeType === "FBAFees" || f.feeType === "FulfillmentFees") {
        fbaCentavos += centavos;
      }
    }
    const comissaoBps =
      preco > 0 ? Math.round((comissaoCentavos / preco) * 10000) : 1200;

    await db.amazonFeeEstimate.upsert({
      where: { produtoId: p.id },
      create: {
        produtoId: p.id,
        comissaoBps,
        fbaCentavos,
        ticketAvaliadoCentavos: preco,
        origem: "api",
        ruleVersion: "spapi-product-fees-v0",
      },
      update: {
        comissaoBps,
        fbaCentavos,
        ticketAvaliadoCentavos: preco,
        origem: "api",
        ruleVersion: "spapi-product-fees-v0",
      },
    });
    // Memory cache do fee-estimator pode ter resultado obsoleto deste SKU.
    const { invalidateFeeEstimateMemoryCache } = await import(
      "@/modules/produtos/fee-estimator"
    );
    invalidateFeeEstimateMemoryCache(p.id);
    okCount += 1;
  }

  return {
    ok: true,
    totalProdutosAtivos: produtos.length,
    fila: filaProduto.length,
    processados: alvos.length,
    sucesso: okCount,
    erros,
  };
}

// ─────────────────────────────────────────────────────────────────────
// AMAZON_FBA_PROMO_EXPIRY_CHECK: verifica se a promo FBA expirou e
// dispara Notificacao + desliga a flag. Roda 24h.
// ─────────────────────────────────────────────────────────────────────

export async function runAmazonFbaPromoExpiryCheck() {
  const { emitirNotificacao } = await import("@/lib/notificacoes");
  const { TipoNotificacao } = await import("@/modules/shared/domain");
  const { invalidateFeeEstimatorConfigCache } = await import(
    "@/modules/produtos/fee-estimator"
  );

  const [ativaCfg, expiraCfg] = await Promise.all([
    db.configuracaoSistema.findUnique({
      where: { chave: "amazon_fee_fba_promo_ativa" },
    }),
    db.configuracaoSistema.findUnique({
      where: { chave: "amazon_fee_fba_promo_expira_em" },
    }),
  ]);

  const ativa = (ativaCfg?.valor ?? "true").toLowerCase() === "true";
  const expira = expiraCfg?.valor ? new Date(expiraCfg.valor) : null;

  if (!ativa || !expira || !Number.isFinite(expira.getTime())) {
    return { ok: true, skip: true, ativa, expira: expira?.toISOString() ?? null };
  }

  const now = new Date();
  if (now <= expira) {
    return {
      ok: true,
      expirou: false,
      diasRestantes: Math.ceil((expira.getTime() - now.getTime()) / 86400_000),
    };
  }

  await db.configuracaoSistema.upsert({
    where: { chave: "amazon_fee_fba_promo_ativa" },
    create: { chave: "amazon_fee_fba_promo_ativa", valor: "false" },
    update: { valor: "false" },
  });
  invalidateFeeEstimatorConfigCache();

  await emitirNotificacao({
    tipo: TipoNotificacao.CONFIG_REVIEW,
    titulo: "Promo FBA expirou",
    descricao: `A promo FBA (R$5/R$0) venceu em ${expira.toISOString().slice(0, 10)}. O estimador agora usa fallback pos-promo. Atualize os valores em Configuracoes se houver nova promo Amazon.`,
    linkRef: "/configuracoes",
    dedupeKey: `fba_promo_expirou:${expira.toISOString().slice(0, 10)}`,
  });

  return { ok: true, expirou: true, expiraEm: expira.toISOString() };
}
