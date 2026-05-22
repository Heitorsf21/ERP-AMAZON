/**
 * Parser de eventos Amazon Marketing Stream (datasets sp-traffic / sp-conversion /
 * sd-traffic / sd-conversion / sb-traffic / sb-conversion).
 *
 * Marketing Stream entrega para SQS standard, agregado por hora, push-based.
 * Cada SQS message tem um envelope com `payload` contendo o record do dataset.
 *
 * Unidades:
 *  - `cost`, `attributedSales*` chegam em **micro-units** da moeda do profile.
 *    1 BRL = 1_000_000 micro-BRL. Convertemos para centavos: micro / 10_000.
 *  - `timeWindowStart` em ISO-UTC. Snapamos para o inicio da hora.
 *
 * Atribuicao em sp-conversion: usamos janela 7d (`attributedSales7d`) para alinhar
 * com o report `spAdvertisedProduct` daily (campo `sales7d`).
 *
 * Eventos > 7 dias sao rejeitados (Marketing Stream garante < 1h delivery — qualquer
 * coisa muito antiga e sinal de incidente, melhor logar e ignorar).
 */
import type { AmazonSqsNotification } from "@/lib/amazon-sqs";

export const MARKETING_STREAM_DATASETS = [
  "sp-traffic",
  "sp-conversion",
  "sd-traffic",
  "sd-conversion",
  "sb-traffic",
  "sb-conversion",
] as const;

export type MarketingStreamDataset = (typeof MARKETING_STREAM_DATASETS)[number];

export type MarketingStreamParsedRow = {
  dataset: MarketingStreamDataset;
  horaInicio: Date;
  profileId: string;
  campaignId: string;
  adGroupId: string | null;
  adId: string | null;
  asin: string | null;
  sku: string | null;
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  unidades: number;
  pedidos: number;
  marketplaceId: string | null;
  currencyCode: string | null;
  eventoTime: Date;
  payload: Record<string, unknown>;
};

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isMarketingStreamNotification(
  notif: AmazonSqsNotification,
): boolean {
  const dataset = getMarketingStreamDataset(notif);
  return dataset !== null;
}

export function getMarketingStreamDataset(
  notif: AmazonSqsNotification,
): MarketingStreamDataset | null {
  const candidates = collectStringValues(notif, [
    "datasetid",
    "datasetId",
    "dataset_id",
    "dataset",
  ]);
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if ((MARKETING_STREAM_DATASETS as readonly string[]).includes(normalized)) {
      return normalized as MarketingStreamDataset;
    }
  }
  const notificationType =
    (typeof notif.NotificationType === "string" && notif.NotificationType) ||
    (typeof notif.notificationType === "string" && notif.notificationType) ||
    "";
  const matched = notificationType.match(/^marketing[-_ ]stream[-_ :]+(.+)$/i);
  if (matched) {
    const normalized = matched[1]!.toLowerCase().replace(/_/g, "-");
    if ((MARKETING_STREAM_DATASETS as readonly string[]).includes(normalized)) {
      return normalized as MarketingStreamDataset;
    }
  }
  return null;
}

export function parseMarketingStreamMessage(
  notif: AmazonSqsNotification,
  now: Date = new Date(),
): MarketingStreamParsedRow[] {
  const dataset = getMarketingStreamDataset(notif);
  if (!dataset) return [];

  const records = collectRecords(notif);
  const rows: MarketingStreamParsedRow[] = [];

  for (const record of records) {
    const row = parseRecord(record, dataset, now);
    if (row) rows.push(row);
  }
  return rows;
}

function parseRecord(
  record: Record<string, unknown>,
  dataset: MarketingStreamDataset,
  now: Date,
): MarketingStreamParsedRow | null {
  const timeWindowStart = parseDate(
    firstString(record, ["timeWindowStart", "timewindowstart", "time_window_start"]),
  );
  if (!timeWindowStart) return null;
  if (now.getTime() - timeWindowStart.getTime() > MAX_AGE_MS) {
    console.warn(
      `[marketing-stream] descartando record antigo dataset=${dataset} start=${timeWindowStart.toISOString()}`,
    );
    return null;
  }
  const horaInicio = startOfUTCHour(timeWindowStart);

  const campaignId = firstString(record, ["campaignId", "campaignid", "campaign_id"]);
  if (!campaignId) return null;

  const profileId =
    firstString(record, ["profileId", "profileid", "profile_id"]) ?? "";
  const adGroupId = firstString(record, ["adGroupId", "adgroupid", "ad_group_id"]);
  const adId = firstString(record, ["adId", "adid", "ad_id"]);
  const asin = firstString(record, ["advertisedAsin", "asin"]);
  const sku = firstString(record, ["advertisedSku", "sku"]);
  const marketplaceId = firstString(record, [
    "marketplaceId",
    "marketplaceid",
    "marketplace_id",
  ]);
  const currencyCode = firstString(record, ["currency", "currencyCode"]);

  const isTraffic = dataset.endsWith("-traffic");
  const isConversion = dataset.endsWith("-conversion");

  const impressoes = isTraffic ? toInt(record["impressions"]) : 0;
  const cliques = isTraffic ? toInt(record["clicks"]) : 0;
  const gastoCentavos = isTraffic ? microToCentavos(record["cost"]) : 0;

  const vendasCentavos = isConversion
    ? microToCentavos(
        record["attributedSales7d"] ??
          record["attributedSales1d"] ??
          record["attributedSales14d"] ??
          record["attributedSales30d"] ??
          0,
      )
    : 0;
  const unidades = isConversion
    ? toInt(
        record["attributedUnitsOrdered7d"] ??
          record["attributedUnitsOrdered1d"] ??
          record["attributedUnitsOrdered14d"] ??
          record["attributedUnitsOrdered30d"] ??
          0,
      )
    : 0;
  const pedidos = isConversion
    ? toInt(
        record["attributedPurchases7d"] ??
          record["attributedPurchases1d"] ??
          record["attributedPurchases14d"] ??
          record["attributedPurchases30d"] ??
          0,
      )
    : 0;

  return {
    dataset,
    horaInicio,
    profileId,
    campaignId,
    adGroupId: adGroupId ?? null,
    adId: adId ?? null,
    asin: asin ?? null,
    sku: sku ?? null,
    impressoes,
    cliques,
    gastoCentavos,
    vendasCentavos,
    unidades,
    pedidos,
    marketplaceId: marketplaceId ?? null,
    currencyCode: currencyCode ?? null,
    eventoTime: timeWindowStart,
    payload: record,
  };
}

function collectRecords(
  notif: AmazonSqsNotification,
): Record<string, unknown>[] {
  const fromPayload =
    notif.Payload ??
    notif.payload ??
    (notif as { Records?: unknown }).Records ??
    (notif as { records?: unknown }).records ??
    null;

  const candidates: unknown[] = [];

  if (Array.isArray(fromPayload)) {
    candidates.push(...fromPayload);
  } else if (fromPayload && typeof fromPayload === "object") {
    const obj = fromPayload as Record<string, unknown>;
    if (Array.isArray(obj.records)) candidates.push(...obj.records);
    else if (Array.isArray(obj.Records)) candidates.push(...obj.Records);
    else candidates.push(obj);
  }

  if (candidates.length === 0) {
    candidates.push(notif as unknown);
  }

  return candidates.filter(
    (c): c is Record<string, unknown> =>
      !!c && typeof c === "object" && !Array.isArray(c),
  );
}

function collectStringValues(
  value: unknown,
  keys: string[],
  depth = 0,
): string[] {
  if (depth > 4 || !value || typeof value !== "object") return [];
  const out: string[] = [];
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k) && typeof v === "string" && v.trim()) {
      out.push(v.trim());
    }
    if (v && typeof v === "object") {
      out.push(...collectStringValues(v, keys, depth + 1));
    }
  }
  return out;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
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

function microToCentavos(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value / 10_000);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n / 10_000) : 0;
  }
  return 0;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : null;
}

function startOfUTCHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}
