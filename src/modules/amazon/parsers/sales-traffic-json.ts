import {
  hashObject,
  parseDateOrNull,
} from "@/modules/amazon/parsers/report-utils";

type Money = {
  amount?: number | string;
  currencyCode?: string;
};

type SalesTrafficByAsin = {
  date?: string;
  parentAsin?: string;
  childAsin?: string;
  sku?: string;
  salesByAsin?: {
    unitsOrdered?: number;
    orderedProductSales?: Money;
    [key: string]: unknown;
  };
  trafficByAsin?: {
    sessions?: number;
    browserSessions?: number;
    mobileAppSessions?: number;
    pageViews?: number;
    browserPageViews?: number;
    mobileAppPageViews?: number;
    buyBoxPercentage?: number;
    unitSessionPercentage?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export interface SalesTrafficDailyRow {
  naturalKey: string;
  sku: string;
  data: Date;
  parentAsin: string | null;
  childAsin: string | null;
  sessoes: number;
  pageViews: number;
  unitsOrdered: number;
  buyBoxPercent: number | null;
  conversaoPercent: number | null;
  orderedRevenueCentavos: number;
  currency: string | null;
  payload: SalesTrafficByAsin;
}

export function parseSalesTrafficJson(
  input: Buffer | string,
  fallbackDate: Date,
): SalesTrafficDailyRow[] {
  const text = typeof input === "string" ? input : input.toString("utf8");
  const parsed = JSON.parse(text) as {
    salesAndTrafficByAsin?: SalesTrafficByAsin[];
  };

  return (parsed.salesAndTrafficByAsin ?? [])
    .map((item) => {
      const traffic = item.trafficByAsin ?? {};
      const sales = item.salesByAsin ?? {};
      const sku = clean(item.sku) || clean(item.childAsin);
      if (!sku) return null;

      const data = startOfUTCDay(parseDateOrNull(item.date) ?? fallbackDate);
      const sessoes =
        num(traffic.sessions) ??
        (num(traffic.browserSessions) ?? 0) + (num(traffic.mobileAppSessions) ?? 0);
      const pageViews =
        num(traffic.pageViews) ??
        (num(traffic.browserPageViews) ?? 0) +
          (num(traffic.mobileAppPageViews) ?? 0);
      const revenue = parseMoney(sales.orderedProductSales);

      return {
        naturalKey: `${sku}|${data.toISOString()}`,
        sku,
        data,
        parentAsin: clean(item.parentAsin),
        childAsin: clean(item.childAsin),
        sessoes,
        pageViews,
        unitsOrdered: num(sales.unitsOrdered) ?? 0,
        buyBoxPercent: num(traffic.buyBoxPercentage),
        conversaoPercent: num(traffic.unitSessionPercentage),
        orderedRevenueCentavos: revenue.centavos,
        currency: revenue.currency,
        payload: item,
      };
    })
    .filter((row): row is SalesTrafficDailyRow => row !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Seção `salesAndTrafficByDate` — métricas no NÍVEL CONTA, com quebra DIÁRIA.
//
// Por que existe (e por que NÃO usar `salesAndTrafficByAsin` para totais):
// a seção byAsin agrega o PERÍODO INTEIRO do report por SKU (não tem dimensão de
// data) — somar várias execuções com janelas sobrepostas infla o total. Já a
// seção byDate traz 1 linha por dia (campo `date`), então é a fonte correta e
// somável para os KPIs de tráfego do dashboard.
// ─────────────────────────────────────────────────────────────────────────────
type SalesByDate = {
  unitsOrdered?: number;
  orderedProductSales?: Money;
  [key: string]: unknown;
};

type TrafficByDate = {
  sessions?: number;
  browserSessions?: number;
  mobileAppSessions?: number;
  pageViews?: number;
  browserPageViews?: number;
  mobileAppPageViews?: number;
  buyBoxPercentage?: number;
  unitSessionPercentage?: number;
  [key: string]: unknown;
};

type SalesTrafficByDate = {
  date?: string;
  salesByDate?: SalesByDate;
  trafficByDate?: TrafficByDate;
  [key: string]: unknown;
};

export interface SalesTrafficDateRow {
  data: Date;
  sessoes: number;
  pageViews: number;
  unitsOrdered: number;
  orderedRevenueCentavos: number;
  buyBoxPercent: number | null;
  conversaoPercent: number | null;
  currency: string | null;
  payload: SalesTrafficByDate;
}

export function parseSalesTrafficByDateJson(
  input: Buffer | string,
): SalesTrafficDateRow[] {
  const text = typeof input === "string" ? input : input.toString("utf8");
  const parsed = JSON.parse(text) as {
    salesAndTrafficByDate?: SalesTrafficByDate[];
  };

  return (parsed.salesAndTrafficByDate ?? [])
    .map((item) => {
      const dataRaw = parseDateOrNull(item.date);
      if (!dataRaw) return null; // sem data não dá pra ancorar no tempo

      const traffic = item.trafficByDate ?? {};
      const sales = item.salesByDate ?? {};
      const sessoes =
        num(traffic.sessions) ??
        (num(traffic.browserSessions) ?? 0) +
          (num(traffic.mobileAppSessions) ?? 0);
      const pageViews =
        num(traffic.pageViews) ??
        (num(traffic.browserPageViews) ?? 0) +
          (num(traffic.mobileAppPageViews) ?? 0);
      const revenue = parseMoney(sales.orderedProductSales);

      return {
        data: startOfUTCDay(dataRaw),
        sessoes,
        pageViews,
        unitsOrdered: num(sales.unitsOrdered) ?? 0,
        orderedRevenueCentavos: revenue.centavos,
        buyBoxPercent: num(traffic.buyBoxPercentage),
        conversaoPercent: num(traffic.unitSessionPercentage),
        currency: revenue.currency,
        payload: item,
      };
    })
    .filter((row): row is SalesTrafficDateRow => row !== null);
}

function parseMoney(value: Money | undefined): {
  centavos: number;
  currency: string | null;
} {
  if (!value) return { centavos: 0, currency: null };
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount);
  return {
    centavos: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
    currency: clean(value.currencyCode),
  };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function trafficPayloadHash(row: SalesTrafficDailyRow): string {
  return hashObject(row.payload);
}
