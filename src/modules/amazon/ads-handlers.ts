/**
 * Handlers Sprint 5.5 — Amazon Advertising (Sponsored Products).
 *
 *  - AMAZON_ADS_REPORT_SYNC: ciclo diario (ultimos 30d) com lifecycle
 *    create -> poll -> download. Pendentes ficam em `amazon_ads_*_pending_*`.
 *  - AMAZON_ADS_BACKFILL: avanca cursor para tras em janelas de ~94 dias
 *    (limite Ads API). Auto-no-op ao alcancar o presente.
 *
 * Em ambos: report `spAdvertisedProduct` granularidade DAILY x ASIN/SKU.
 */

import { db } from "@/lib/db";
import {
  createSpAdvertisedProductReport,
  downloadAdsReport,
  getAdsReport,
  type AdsAPICredentials,
} from "@/lib/amazon-ads-api";
import {
  AmazonQuotaCooldownError,
  isAmazonQuotaCooldownError,
} from "@/lib/amazon-rate-limit";
import { notificarAcosAlto } from "@/lib/notificacoes";
import { parseSpAdvertisedProductRows } from "@/modules/amazon/parsers/sp-advertised-product-json";
import { addDays } from "date-fns";

const ADS_REPORT_PENDING_KEY = "amazon_ads_report_pending_id";
const ADS_REPORT_PENDING_START_KEY = "amazon_ads_report_pending_start";
const ADS_REPORT_PENDING_END_KEY = "amazon_ads_report_pending_end";

const ADS_BACKFILL_PENDING_KEY = "amazon_ads_backfill_pending_id";
const ADS_BACKFILL_CURSOR_KEY = "amazon_ads_backfill_cursor"; // ISO date — ja processado ATE essa data
const ADS_BACKFILL_PENDING_START_KEY = "amazon_ads_backfill_pending_start";
const ADS_BACKFILL_PENDING_END_KEY = "amazon_ads_backfill_pending_end";

const ADS_BACKFILL_DEFAULT_HISTORY_DAYS = 365;
// Ads API aceita ~95 dias por janela; deixamos 90 com folga.
const ADS_BACKFILL_WINDOW_DAYS = 90;
// ACOS limiar para alerta (fracao). 0.30 = 30% — coerente com regra existente.
const ACOS_ALERT_THRESHOLD = 0.3;
// Lookback do alerta — agrega ultimos 7d de gasto/vendas por SKU.
const ACOS_ALERT_LOOKBACK_DAYS = 7;
const ACOS_ALERT_MIN_GASTO_CENTAVOS = 5_000; // ignora ruido (< R$50)

type AdsSyncPayload = {
  diasAtras?: number;
};

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
  await db.configuracaoSistema.deleteMany({ where: { chave } });
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Lifecycle generico ─────────────────────────────────────────────────────

type LifecycleResult =
  | { status: "PENDING_NEW"; reportId: string }
  | { status: "PENDING_PROCESSING"; reportId: string; processingStatus: string }
  | { status: "FAILED"; reportId: string; processingStatus: string }
  | { status: "DONE"; reportId: string; rowsCount: number; rows: ReturnType<typeof parseSpAdvertisedProductRows> };

async function stepAdsReportLifecycle(
  creds: AdsAPICredentials,
  args: {
    pendingReportId: string | null;
    startDate: Date;
    endDate: Date;
  },
): Promise<LifecycleResult> {
  if (!args.pendingReportId) {
    const created = await createSpAdvertisedProductReport(creds, {
      startDate: toIsoDate(args.startDate),
      endDate: toIsoDate(args.endDate),
    });
    return { status: "PENDING_NEW", reportId: created.reportId };
  }

  const ref = await getAdsReport(creds, args.pendingReportId);
  const status = (ref.status || "").toUpperCase();

  if (status === "COMPLETED" || status === "SUCCESS") {
    if (!ref.url) {
      return {
        status: "FAILED",
        reportId: ref.reportId,
        processingStatus: "NO_URL",
      };
    }
    const rawRows = await downloadAdsReport(ref.url);
    const rows = parseSpAdvertisedProductRows(rawRows);
    return {
      status: "DONE",
      reportId: ref.reportId,
      rowsCount: rows.length,
      rows,
    };
  }

  if (status === "FAILED" || status === "CANCELLED") {
    return {
      status: "FAILED",
      reportId: ref.reportId,
      processingStatus: status,
    };
  }

  return {
    status: "PENDING_PROCESSING",
    reportId: ref.reportId,
    processingStatus: status || "UNKNOWN",
  };
}

// ── Persistencia ──────────────────────────────────────────────────────────

async function upsertAdsRows(
  rows: ReturnType<typeof parseSpAdvertisedProductRows>,
  syncedAt: Date,
) {
  let novas = 0;
  let atualizadas = 0;

  // 1) Garante AmazonAdsCampanha (uma por campaignId vista no batch).
  const campanhasMap = new Map<
    string,
    { campaignId: string; nome: string }
  >();
  for (const r of rows) {
    if (!campanhasMap.has(r.campaignId)) {
      campanhasMap.set(r.campaignId, {
        campaignId: r.campaignId,
        nome: r.campaignName ?? r.campaignId,
      });
    }
  }

  for (const c of campanhasMap.values()) {
    await db.amazonAdsCampanha.upsert({
      where: { campaignId: c.campaignId },
      create: {
        campaignId: c.campaignId,
        profileId: "", // preenchido por sync separado /sp/campaigns/list (futuro)
        nome: c.nome,
        ultimaSync: syncedAt,
        payloadJson: JSON.stringify({ derivedFromReport: true }),
      },
      update: {
        nome: c.nome,
        ultimaSync: syncedAt,
      },
    });
  }

  // 2) Resolve produtoId por SKU (single round-trip).
  const skus = Array.from(
    new Set(rows.map((r) => r.sku).filter((s): s is string => !!s)),
  );
  const produtos = skus.length
    ? await db.produto.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true },
      })
    : [];
  const produtoIdBySku = new Map(produtos.map((p) => [p.sku, p.id]));

  // 3) Upsert metricas diarias.
  for (const r of rows) {
    const produtoId = r.sku ? produtoIdBySku.get(r.sku) ?? null : null;
    const where = {
      data_campaignId_adGroupId_asin_sku: {
        data: r.data,
        campaignId: r.campaignId,
        adGroupId: r.adGroupId,
        asin: r.asin,
        sku: r.sku,
      },
    };
    const data = {
      data: r.data,
      campaignId: r.campaignId,
      adGroupId: r.adGroupId,
      asin: r.asin,
      sku: r.sku,
      impressoes: r.impressoes,
      cliques: r.cliques,
      gastoCentavos: r.gastoCentavos,
      vendasCentavos: r.vendasCentavos,
      unidades: r.unidades,
      pedidos: r.pedidos,
      acos: r.acos,
      produtoId,
      payloadJson: JSON.stringify(r.payload),
    };
    try {
      const existing = await db.amazonAdsMetricaDiaria.findUnique({
        where: where as never,
      });
      if (!existing) {
        await db.amazonAdsMetricaDiaria.create({ data });
        novas++;
      } else {
        await db.amazonAdsMetricaDiaria.update({
          where: { id: existing.id },
          data,
        });
        atualizadas++;
      }
    } catch (err) {
      console.warn("[ads] upsert falhou", err);
    }
  }

  return { criadas: novas, atualizadas };
}

// ── Alerta ACOS_ALTO ──────────────────────────────────────────────────────

async function dispararAlertasAcos(now: Date) {
  const inicio = addDays(startOfUTCDay(now), -ACOS_ALERT_LOOKBACK_DAYS + 1);
  const grupos = await db.amazonAdsMetricaDiaria.groupBy({
    by: ["sku"],
    where: { data: { gte: inicio }, sku: { not: null } },
    _sum: { gastoCentavos: true, vendasCentavos: true },
  });

  let alertas = 0;
  for (const g of grupos) {
    const sku = g.sku;
    if (!sku) continue;
    const gasto = g._sum.gastoCentavos ?? 0;
    const vendas = g._sum.vendasCentavos ?? 0;
    if (gasto < ACOS_ALERT_MIN_GASTO_CENTAVOS) continue;
    if (vendas <= 0) continue;
    const acos = gasto / vendas;
    if (acos < ACOS_ALERT_THRESHOLD) continue;
    await notificarAcosAlto({
      sku,
      acos,
      janelaDias: ACOS_ALERT_LOOKBACK_DAYS,
      gastoCentavos: gasto,
      vendasCentavos: vendas,
    });
    alertas++;
  }
  return alertas;
}

// ── Handlers ──────────────────────────────────────────────────────────────

export async function runAmazonAdsReportSync(
  creds: AdsAPICredentials,
  payload: AdsSyncPayload = {},
) {
  const end = startOfUTCDay(addDays(new Date(), -1)); // ate ontem (Amazon nao tem hoje fechado)
  const start = startOfUTCDay(addDays(end, -(payload.diasAtras ?? 30) + 1));

  const pendingId = await getCfg(ADS_REPORT_PENDING_KEY);

  let lifecycle: LifecycleResult;
  try {
    lifecycle = await stepAdsReportLifecycle(creds, {
      pendingReportId: pendingId,
      startDate: start,
      endDate: end,
    });
  } catch (err) {
    if (err instanceof AmazonQuotaCooldownError || isAmazonQuotaCooldownError(err)) {
      throw err;
    }
    throw err;
  }

  if (lifecycle.status === "PENDING_NEW") {
    await setCfg(ADS_REPORT_PENDING_KEY, lifecycle.reportId);
    await setCfg(ADS_REPORT_PENDING_START_KEY, start.toISOString());
    await setCfg(ADS_REPORT_PENDING_END_KEY, end.toISOString());
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: lifecycle.reportId,
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
    await delCfg(ADS_REPORT_PENDING_KEY);
    await delCfg(ADS_REPORT_PENDING_START_KEY);
    await delCfg(ADS_REPORT_PENDING_END_KEY);
    return {
      ok: false,
      reportId: lifecycle.reportId,
      processingStatus: lifecycle.processingStatus,
      mensagem: `Report Ads ${lifecycle.reportId} terminou em ${lifecycle.processingStatus}`,
    };
  }

  const stats = await upsertAdsRows(lifecycle.rows, new Date());
  const alertas = await dispararAlertasAcos(new Date());
  await delCfg(ADS_REPORT_PENDING_KEY);
  await delCfg(ADS_REPORT_PENDING_START_KEY);
  await delCfg(ADS_REPORT_PENDING_END_KEY);
  return {
    ok: true,
    reportId: lifecycle.reportId,
    linhas: lifecycle.rowsCount,
    ...stats,
    alertasAcos: alertas,
  };
}

export async function runAmazonAdsBackfill(creds: AdsAPICredentials) {
  const today = startOfUTCDay(new Date());
  const earliestEnd = addDays(today, -1);

  // Cursor representa o INICIO da proxima janela a buscar (ja processei daqui pra frente).
  const cursorIso = await getCfg(ADS_BACKFILL_CURSOR_KEY);
  const cursor = cursorIso
    ? new Date(cursorIso)
    : addDays(today, -ADS_BACKFILL_DEFAULT_HISTORY_DAYS);

  if (cursor >= earliestEnd) {
    return {
      ok: true,
      completo: true,
      cursor: cursor.toISOString(),
      mensagem: "Backfill Ads alcancou o periodo recente.",
    };
  }

  const pendingId = await getCfg(ADS_BACKFILL_PENDING_KEY);
  const pendingStartIso = await getCfg(ADS_BACKFILL_PENDING_START_KEY);
  const pendingEndIso = await getCfg(ADS_BACKFILL_PENDING_END_KEY);

  // Janela: do cursor (inicio) ate cursor+window, capando em earliestEnd.
  const start = pendingStartIso ? new Date(pendingStartIso) : startOfUTCDay(cursor);
  const tentativeEnd = addDays(start, ADS_BACKFILL_WINDOW_DAYS - 1);
  const end = pendingEndIso
    ? new Date(pendingEndIso)
    : tentativeEnd > earliestEnd
      ? earliestEnd
      : tentativeEnd;

  const lifecycle = await stepAdsReportLifecycle(creds, {
    pendingReportId: pendingId,
    startDate: start,
    endDate: end,
  });

  if (lifecycle.status === "PENDING_NEW") {
    await setCfg(ADS_BACKFILL_PENDING_KEY, lifecycle.reportId);
    await setCfg(ADS_BACKFILL_PENDING_START_KEY, start.toISOString());
    await setCfg(ADS_BACKFILL_PENDING_END_KEY, end.toISOString());
    return {
      ok: true,
      pending: true,
      created: true,
      reportId: lifecycle.reportId,
      janela: { start: toIsoDate(start), end: toIsoDate(end) },
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
    await delCfg(ADS_BACKFILL_PENDING_KEY);
    await delCfg(ADS_BACKFILL_PENDING_START_KEY);
    await delCfg(ADS_BACKFILL_PENDING_END_KEY);
    return {
      ok: false,
      reportId: lifecycle.reportId,
      processingStatus: lifecycle.processingStatus,
      mensagem: `Backfill Ads ${lifecycle.reportId} terminou em ${lifecycle.processingStatus}`,
    };
  }

  const stats = await upsertAdsRows(lifecycle.rows, new Date());

  // Avanca cursor para o dia seguinte ao fim da janela processada.
  const novoCursor = addDays(end, 1);
  await setCfg(ADS_BACKFILL_CURSOR_KEY, novoCursor.toISOString());
  await delCfg(ADS_BACKFILL_PENDING_KEY);
  await delCfg(ADS_BACKFILL_PENDING_START_KEY);
  await delCfg(ADS_BACKFILL_PENDING_END_KEY);

  return {
    ok: true,
    reportId: lifecycle.reportId,
    linhas: lifecycle.rowsCount,
    janela: { start: toIsoDate(start), end: toIsoDate(end) },
    cursor: novoCursor.toISOString(),
    ...stats,
  };
}
