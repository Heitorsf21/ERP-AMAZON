/**
 * Handlers para os jobs novos (Sprint 3 + Sprint 4):
 *  - SETTLEMENT_REPORT_SYNC : baixa relatórios de liquidação automaticamente
 *  - BUYBOX_CHECK           : checa buybox por SKU rotacionando ASINs
 *  - CATALOG_REFRESH        : atualiza catálogo (imagem, título, categoria)
 *  - reconciliarRecebimentosAmazon: cruza extrato Nubank ↔ ContaReceber
 *
 * Cada handler é chamado pelo worker em src/modules/amazon/worker.ts.
 */
import { gunzipSync } from "node:zlib";
import { db } from "@/lib/db";
import {
  getCatalogItem,
  getProductOffers,
  getReportDocument,
  getSettlementReports,
  type SPAPICredentials,
  type SPCatalogItem,
} from "@/lib/amazon-sp-api";
import {
  notificarBuyboxPerdido,
  notificarBuyboxRecuperado,
  notificarReconciliado,
  notificarSettlementNovo,
} from "@/lib/notificacoes";
import { contasReceberService } from "@/modules/contas-a-receber/service";
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
  const reports = await getSettlementReports(creds, 5);

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
      const doc = await getReportDocument(creds, report.reportDocumentId);
      if (!doc?.url) {
        erros++;
        continue;
      }

      const csvBuffer = await downloadReportDocument(doc.url, doc.compressionAlgorithm);
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
    } catch (err) {
      console.warn("settlement-sync erro:", err);
      erros++;
    }
  }

  return { ok: true, reports: reports.length, baixados, novos, erros };
}

async function downloadReportDocument(
  url: string,
  compression?: string,
): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download settlement ${res.status}`);
  const ab = await res.arrayBuffer();
  let buffer = Buffer.from(ab);
  if (compression === "GZIP") buffer = gunzipSync(buffer);
  return buffer;
}

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
    select: { id: true, sku: true, asin: true, buyboxGanho: true, precoVenda: true },
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

    const buyboxOffer = offers.offers?.find((o) => o.isBuyBoxWinner);
    const buyboxPriceFromSummary = offers.summary?.buyBoxPrices?.[0];
    const buyboxPrice =
      buyboxOffer?.listingPrice?.amount ??
      buyboxPriceFromSummary?.listingPrice?.amount ??
      buyboxPriceFromSummary?.landedPrice?.amount;
    const buyboxPriceCentavos = buyboxPrice ? Math.round(buyboxPrice * 100) : null;
    const numeroOfertas = offers.offers?.length ?? null;
    const sellerBuybox = buyboxOffer?.sellerId ?? null;

    // Determinação de quem ganhou o buybox:
    //  1) Preferencial: comparar sellerId do winner com o nosso `amazon_seller_id`.
    //  2) Fallback: comparar preço (proxy fraco) — usado quando a SP-API
    //     não retorna sellerId no offer (ocorre em algumas variações da API
    //     ou quando a oferta vem só pelo summary `buyBoxPrices`).
    let somosBuybox: boolean | null = null;
    if (ourSellerId && sellerBuybox) {
      somosBuybox = sellerBuybox === ourSellerId;
    } else if (buyboxOffer && p.precoVenda) {
      // Fallback de preço: tolerância de R$ 0,50.
      somosBuybox =
        Math.abs((buyboxOffer.listingPrice?.amount ?? 0) * 100 - p.precoVenda) <= 50;
    }

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
          precoNosso: p.precoVenda,
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
        precoNosso: p.precoVenda,
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
    select: { id: true, asin: true },
  });

  let atualizados = 0;
  let semDados = 0;

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

    await db.produto.update({
      where: { id: p.id },
      data: {
        amazonImagemUrl: extractMainImage(item) ?? undefined,
        amazonTituloOficial: extractTitle(item) ?? undefined,
        amazonCategoria: extractCategory(item) ?? undefined,
        amazonCatalogSyncEm: new Date(),
      },
    });
    atualizados++;
  }

  return { ok: true, atualizados, semDados };
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

