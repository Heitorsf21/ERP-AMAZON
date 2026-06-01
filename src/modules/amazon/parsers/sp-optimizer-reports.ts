import { hashObject, parseDateOrNull } from "@/modules/amazon/parsers/report-utils";
import type { AdsReportRow } from "@/lib/amazon-ads-api";

export type AdsOptimizerMetricRow = {
  naturalKey: string;
  data: Date;
  campaignId: string;
  portfolioId: string | null;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  entityType: "KEYWORD" | "TARGET";
  entityId: string;
  keywordId: string | null;
  targetId: string | null;
  keywordText: string | null;
  targetingText: string | null;
  matchType: string | null;
  sku: string | null;
  asin: string | null;
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  unidades: number;
  pedidos: number;
  acos: number | null;
  payload: AdsReportRow;
};

export type AdsOptimizerSearchTermRow = AdsOptimizerMetricRow & {
  searchTerm: string;
};

export function parseSpTargetingRows(
  rows: AdsReportRow[],
): AdsOptimizerMetricRow[] {
  return rows
    .map((row) => parseBaseRow(row))
    .filter((row): row is AdsOptimizerMetricRow => row !== null);
}

export function parseSpSearchTermRows(
  rows: AdsReportRow[],
): AdsOptimizerSearchTermRow[] {
  return rows
    .map((row) => {
      const base = parseBaseRow(row);
      const searchTerm = firstString(row, ["searchTerm", "query"]);
      if (!base || !searchTerm) return null;
      return {
        ...base,
        searchTerm,
        naturalKey: hashObject({
          ...naturalKeyParts(base),
          searchTerm,
          report: "spSearchTerm",
        }),
      };
    })
    .filter((row): row is AdsOptimizerSearchTermRow => row !== null);
}

function parseBaseRow(row: AdsReportRow): AdsOptimizerMetricRow | null {
  const campaignId = firstString(row, ["campaignId"]);
  if (!campaignId) return null;

  const data = startOfUTCDay(
    parseDateOrNull(firstString(row, ["date", "startDate"])) ?? new Date(),
  );
  const keywordId = firstString(row, ["keywordId"]);
  const targetId = firstString(row, ["targetId"]);
  const keywordText = firstString(row, ["keyword", "keywordText"]);
  const targetingText = firstString(row, [
    "targeting",
    "targetingText",
    "targetingExpression",
    "matchedTarget",
  ]);
  const entityType = keywordId ? "KEYWORD" : "TARGET";
  const entityId =
    keywordId ??
    targetId ??
    hashObject({
      campaignId,
      adGroupId: firstString(row, ["adGroupId"]),
      targetingText,
      keywordText,
      matchType: firstString(row, ["matchType", "keywordType", "targetingType"]),
    });

  const gastoCentavos = toCentavos(row.cost ?? row.spend);
  const vendasCentavos = toCentavos(
    row.sales7d ?? row.attributedSales7d ?? row.sales14d,
  );

  const base: AdsOptimizerMetricRow = {
    naturalKey: "",
    data,
    campaignId,
    portfolioId: firstString(row, ["portfolioId"]),
    campaignName: firstString(row, ["campaignName"]),
    adGroupId: firstString(row, ["adGroupId"]),
    adGroupName: firstString(row, ["adGroupName"]),
    entityType,
    entityId,
    keywordId,
    targetId,
    keywordText,
    targetingText,
    matchType: firstString(row, ["matchType", "keywordType", "targetingType"]),
    sku: firstString(row, ["advertisedSku", "sku"]),
    asin: firstString(row, ["advertisedAsin", "asin"]),
    impressoes: toInt(row.impressions),
    cliques: toInt(row.clicks),
    gastoCentavos,
    vendasCentavos,
    unidades: toInt(row.unitsSoldClicks7d ?? row.unitsSold7d),
    pedidos: toInt(row.purchases7d ?? row.orders7d),
    acos: vendasCentavos > 0 ? gastoCentavos / vendasCentavos : null,
    payload: row,
  };
  base.naturalKey = hashObject({ ...naturalKeyParts(base), report: "spTargeting" });
  return base;
}

function naturalKeyParts(row: AdsOptimizerMetricRow) {
  return {
    data: row.data.toISOString(),
    campaignId: row.campaignId,
    portfolioId: row.portfolioId,
    adGroupId: row.adGroupId,
    entityType: row.entityType,
    entityId: row.entityId,
    sku: row.sku,
    asin: row.asin,
  };
}

function firstString(row: AdsReportRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function toInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }
  return 0;
}

function toCentavos(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  return 0;
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
