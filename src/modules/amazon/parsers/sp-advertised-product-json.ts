import {
  hashObject,
  parseDateOrNull,
} from "@/modules/amazon/parsers/report-utils";

import type { SpAdvertisedProductRow } from "@/lib/amazon-ads-api";

export interface AdsAdvertisedProductDailyRow {
  naturalKey: string;
  data: Date;
  campaignId: string;
  adGroupId: string | null;
  asin: string | null;
  sku: string | null;
  campaignName: string | null;
  adGroupName: string | null;
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  unidades: number;
  pedidos: number;
  acos: number | null;
  payload: SpAdvertisedProductRow;
}

export function parseSpAdvertisedProductRows(
  rows: SpAdvertisedProductRow[],
): AdsAdvertisedProductDailyRow[] {
  return rows
    .map((row) => {
      const campaignId = clean(row.campaignId);
      if (!campaignId) return null;

      const data = startOfUTCDay(parseDateOrNull(asString(row.date)) ?? new Date());

      const gastoCentavos = toCentavos(row.cost);
      const vendasCentavos = toCentavos(row.sales7d);
      const unidades = toInt(row.unitsSoldClicks7d);
      const pedidos = toInt(row.purchases7d);

      // Recalcula ACOS local — fonte de verdade: gasto / vendas. O campo
      // acosClicks7d que vem da Amazon eh em fracao (0.42 = 42%); guardamos
      // o nosso em fracao tambem para consistencia.
      const acos =
        vendasCentavos > 0 ? gastoCentavos / vendasCentavos : null;

      return {
        naturalKey: hashObject({
          d: data.toISOString(),
          c: campaignId,
          ag: clean(row.adGroupId),
          a: clean(row.advertisedAsin),
          s: clean(row.advertisedSku),
        }),
        data,
        campaignId,
        adGroupId: clean(row.adGroupId),
        asin: clean(row.advertisedAsin),
        sku: clean(row.advertisedSku),
        campaignName: clean(row.campaignName),
        adGroupName: clean(row.adGroupName),
        impressoes: toInt(row.impressions),
        cliques: toInt(row.clicks),
        gastoCentavos,
        vendasCentavos,
        unidades,
        pedidos,
        acos,
        payload: row,
      };
    })
    .filter((r): r is AdsAdvertisedProductDailyRow => r !== null);
}

function clean(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function toInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

function toCentavos(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  return 0;
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
