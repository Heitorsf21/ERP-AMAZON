import { db } from "@/lib/db";

export const AmazonSpApiOperation = {
  ORDERS_SEARCH: "ORDERS_SEARCH",
  ORDERS_GET: "ORDERS_GET",
  FINANCES_LIST_TRANSACTIONS: "FINANCES_LIST_TRANSACTIONS",
  INVENTORY_SUMMARIES: "INVENTORY_SUMMARIES",
  REPORTS_CREATE: "REPORTS_CREATE",
  REPORTS_GET: "REPORTS_GET",
  REPORTS_GET_BY_ID: "REPORTS_GET_BY_ID",
  REPORTS_GET_DOCUMENT: "REPORTS_GET_DOCUMENT",
  SOLICITATIONS_GET_ACTIONS: "SOLICITATIONS_GET_ACTIONS",
  SOLICITATIONS_CREATE_REVIEW: "SOLICITATIONS_CREATE_REVIEW",
  CATALOG_GET_ITEM: "CATALOG_GET_ITEM",
  PRODUCT_PRICING_GET_OFFERS: "PRODUCT_PRICING_GET_OFFERS",
  SELLERS_GET: "SELLERS_GET",
  LISTINGS_GET_ITEM: "LISTINGS_GET_ITEM",
  ADS_REPORTS_CREATE: "ADS_REPORTS_CREATE",
  ADS_REPORTS_GET: "ADS_REPORTS_GET",
  ADS_REPORTS_DOWNLOAD: "ADS_REPORTS_DOWNLOAD",
  ADS_PROFILES_GET: "ADS_PROFILES_GET",
  ADS_CAMPAIGNS_LIST: "ADS_CAMPAIGNS_LIST",
} as const;

export type AmazonSpApiOperation =
  (typeof AmazonSpApiOperation)[keyof typeof AmazonSpApiOperation];

type OperationLimit = {
  rateLimitPerSecond: number;
  burst: number;
};

// Limites oficiais por endpoint da SP-API.
// Fontes: https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits
//
// IMPORTANTE: cada conta pode receber um limite maior do que o piso aqui.
// O header `x-amzn-RateLimit-Limit` na resposta da Amazon traz o limite real
// para sua conta. Usamos `adoptObservedRateLimit` para subir o teto sem nunca
// passar do que ela permite.
const OPERATION_LIMITS: Record<AmazonSpApiOperation, OperationLimit> = {
  // Orders API getOrders: 0.0167 rps (1 req a cada 60s), burst 20.
  [AmazonSpApiOperation.ORDERS_SEARCH]: { rateLimitPerSecond: 0.0167, burst: 20 },
  // Orders API getOrder (single): 0.5 rps, burst 30.
  [AmazonSpApiOperation.ORDERS_GET]: { rateLimitPerSecond: 0.5, burst: 30 },
  // Finances v2024-06-19 listTransactions: 0.5 rps, burst 10.
  [AmazonSpApiOperation.FINANCES_LIST_TRANSACTIONS]: {
    rateLimitPerSecond: 0.5,
    burst: 10,
  },
  // FBA Inventory v1 getInventorySummaries: 2 rps, burst 2.
  [AmazonSpApiOperation.INVENTORY_SUMMARIES]: {
    rateLimitPerSecond: 2,
    burst: 2,
  },
  // Reports API createReport: 0.0167 rps, burst 15.
  [AmazonSpApiOperation.REPORTS_CREATE]: {
    rateLimitPerSecond: 0.0167,
    burst: 15,
  },
  // Reports API getReports (lista): 0.0222 rps, burst 10.
  [AmazonSpApiOperation.REPORTS_GET]: {
    rateLimitPerSecond: 0.0222,
    burst: 10,
  },
  // Reports API getReport (by ID / polling): 2 rps, burst 15 — limite separado.
  [AmazonSpApiOperation.REPORTS_GET_BY_ID]: {
    rateLimitPerSecond: 2,
    burst: 15,
  },
  // Reports API getReportDocument: 0.0167 rps, burst 15.
  [AmazonSpApiOperation.REPORTS_GET_DOCUMENT]: {
    rateLimitPerSecond: 0.0167,
    burst: 15,
  },
  // Solicitations getSolicitationActionsForOrder: 1 rps, burst 5.
  [AmazonSpApiOperation.SOLICITATIONS_GET_ACTIONS]: {
    rateLimitPerSecond: 1,
    burst: 5,
  },
  // Solicitations createProductReviewAndSellerFeedbackSolicitation: 1 rps, burst 5.
  [AmazonSpApiOperation.SOLICITATIONS_CREATE_REVIEW]: {
    rateLimitPerSecond: 1,
    burst: 5,
  },
  // Catalog Items v2022-04-01 getCatalogItem: 2 rps, burst 2.
  [AmazonSpApiOperation.CATALOG_GET_ITEM]: {
    rateLimitPerSecond: 2,
    burst: 2,
  },
  // Product Pricing v2022-05-01 getItemOffers (single ASIN): 0.5 rps, burst 1.
  [AmazonSpApiOperation.PRODUCT_PRICING_GET_OFFERS]: {
    rateLimitPerSecond: 0.5,
    burst: 1,
  },
  // Sellers v1 getMarketplaceParticipations: 0.016 rps, burst 15.
  [AmazonSpApiOperation.SELLERS_GET]: {
    rateLimitPerSecond: 0.016,
    burst: 15,
  },
  // Listings Items v2021-08-01 getListingsItem: 5 rps, burst 10.
  [AmazonSpApiOperation.LISTINGS_GET_ITEM]: {
    rateLimitPerSecond: 5,
    burst: 10,
  },
  // Ads API v3 reporting/reports POST. Limites Ads sao mais generosos que SP-API;
  // mantemos conservador e deixamos `adoptObservedRateLimit` calibrar via header.
  [AmazonSpApiOperation.ADS_REPORTS_CREATE]: {
    rateLimitPerSecond: 1,
    burst: 10,
  },
  // Ads API v3 reporting/reports/{id} GET — polling status do report.
  [AmazonSpApiOperation.ADS_REPORTS_GET]: {
    rateLimitPerSecond: 5,
    burst: 10,
  },
  // GET S3 do url devolvido em status DONE — sem cooldown agressivo.
  [AmazonSpApiOperation.ADS_REPORTS_DOWNLOAD]: {
    rateLimitPerSecond: 1,
    burst: 5,
  },
  // GET /v2/profiles — chamada pontual (descobrir profileId).
  [AmazonSpApiOperation.ADS_PROFILES_GET]: {
    rateLimitPerSecond: 1,
    burst: 5,
  },
  // POST /sp/campaigns/list (paginacao para upsert de AmazonAdsCampanha).
  [AmazonSpApiOperation.ADS_CAMPAIGNS_LIST]: {
    rateLimitPerSecond: 5,
    burst: 10,
  },
};

export class AmazonQuotaCooldownError extends Error {
  operation: AmazonSpApiOperation;
  nextAllowedAt: Date;

  constructor(operation: AmazonSpApiOperation, nextAllowedAt: Date) {
    super(
      `Amazon SP-API operation ${operation} em cooldown ate ${nextAllowedAt.toISOString()}`,
    );
    this.name = "AmazonQuotaCooldownError";
    this.operation = operation;
    this.nextAllowedAt = nextAllowedAt;
  }
}

export function isAmazonQuotaCooldownError(
  error: unknown,
): error is AmazonQuotaCooldownError {
  return error instanceof AmazonQuotaCooldownError;
}

// Cache em memória do rps efetivo por operação (default ou observado).
// Reduz round-trip ao banco em hot path.
const effectiveRpsCache = new Map<string, number>();

function getEffectiveRps(operation: AmazonSpApiOperation): number {
  return effectiveRpsCache.get(operation) ?? OPERATION_LIMITS[operation].rateLimitPerSecond;
}

function getEffectiveDelayMs(operation: AmazonSpApiOperation): number {
  const rate = getEffectiveRps(operation);
  return Math.max(250, Math.ceil(1000 / Math.max(rate, 0.0001)));
}

export async function reserveAmazonOperationSlot(
  operation: AmazonSpApiOperation,
  now = new Date(),
) {
  const limit = OPERATION_LIMITS[operation];
  const current = await db.amazonApiQuota.findUnique({ where: { operation } });

  // Sincroniza o cache com observedRps salvo no banco (na primeira chamada).
  if (current?.observedRps && !effectiveRpsCache.has(operation)) {
    effectiveRpsCache.set(operation, current.observedRps);
  }

  if (current?.nextAllowedAt && current.nextAllowedAt > now) {
    throw new AmazonQuotaCooldownError(operation, current.nextAllowedAt);
  }

  const nextAllowedAt = new Date(now.getTime() + getEffectiveDelayMs(operation));
  await db.amazonApiQuota.upsert({
    where: { operation },
    create: {
      operation,
      nextAllowedAt,
      rateLimitPerSecond: limit.rateLimitPerSecond,
      burst: limit.burst,
      lastAttemptAt: now,
    },
    update: {
      nextAllowedAt,
      rateLimitPerSecond: limit.rateLimitPerSecond,
      burst: limit.burst,
      lastAttemptAt: now,
      lastError: null,
    },
  });

  return { nextAllowedAt };
}

export async function markAmazonOperationSuccess(
  operation: AmazonSpApiOperation,
  status: number,
) {
  const limit = OPERATION_LIMITS[operation];
  await db.amazonApiQuota.upsert({
    where: { operation },
    create: {
      operation,
      rateLimitPerSecond: limit.rateLimitPerSecond,
      burst: limit.burst,
      lastStatus: status,
      lastAttemptAt: new Date(),
    },
    update: {
      lastStatus: status,
      lastError: null,
      lastAttemptAt: new Date(),
    },
  });
}

export async function markAmazonOperationRateLimited({
  operation,
  status,
  retryAfterHeader,
  message,
}: {
  operation: AmazonSpApiOperation;
  status: number;
  retryAfterHeader?: string | null;
  message: string;
}) {
  const now = new Date();
  const retryAfterMs =
    parseRetryAfterMs(retryAfterHeader, now) ?? getEffectiveDelayMs(operation) * 2;
  const nextAllowedAt = new Date(now.getTime() + retryAfterMs);
  const limit = OPERATION_LIMITS[operation];

  await db.amazonApiQuota.upsert({
    where: { operation },
    create: {
      operation,
      nextAllowedAt,
      rateLimitPerSecond: limit.rateLimitPerSecond,
      burst: limit.burst,
      lastStatus: status,
      lastError: message,
      lastAttemptAt: now,
    },
    update: {
      nextAllowedAt,
      rateLimitPerSecond: limit.rateLimitPerSecond,
      burst: limit.burst,
      lastStatus: status,
      lastError: message,
      lastAttemptAt: now,
    },
  });

  return { nextAllowedAt };
}

/**
 * Lê o header `x-amzn-RateLimit-Limit` da resposta da Amazon e adota como rate
 * efetivo se for maior que o default. Nunca reduz o default.
 *
 * Header vem em rps decimal (ex: "0.0167" = 1 req a cada 60s).
 */
export async function adoptObservedRateLimit(
  operation: AmazonSpApiOperation,
  rateLimitHeader: string | null | undefined,
) {
  if (!rateLimitHeader) return;
  const observed = Number(rateLimitHeader);
  if (!Number.isFinite(observed) || observed <= 0) return;

  const default_ = OPERATION_LIMITS[operation].rateLimitPerSecond;
  // Não confiamos em valores absurdamente altos; cap em 100x do default por segurança.
  const cap = default_ * 100;
  const effective = Math.min(Math.max(observed, default_), cap);

  // Se já está cacheado com o mesmo valor, nada a fazer.
  if (Math.abs((effectiveRpsCache.get(operation) ?? 0) - effective) < 1e-6) return;

  effectiveRpsCache.set(operation, effective);
  try {
    await db.amazonApiQuota.update({
      where: { operation },
      data: { observedRps: effective },
    });
  } catch {
    // Sem registro ainda — ignoramos; reserveAmazonOperationSlot vai criar.
  }
}

export async function getAmazonQuotaSnapshot() {
  return db.amazonApiQuota.findMany({ orderBy: { operation: "asc" } });
}

function parseRetryAfterMs(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - now.getTime());
}
