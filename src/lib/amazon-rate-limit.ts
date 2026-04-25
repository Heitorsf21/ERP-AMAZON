import { db } from "@/lib/db";

export const AmazonSpApiOperation = {
  ORDERS_SEARCH: "ORDERS_SEARCH",
  ORDERS_GET: "ORDERS_GET",
  FINANCES_LIST_TRANSACTIONS: "FINANCES_LIST_TRANSACTIONS",
  INVENTORY_SUMMARIES: "INVENTORY_SUMMARIES",
  REPORTS_CREATE: "REPORTS_CREATE",
  REPORTS_GET: "REPORTS_GET",
  REPORTS_GET_DOCUMENT: "REPORTS_GET_DOCUMENT",
  SOLICITATIONS_GET_ACTIONS: "SOLICITATIONS_GET_ACTIONS",
  SOLICITATIONS_CREATE_REVIEW: "SOLICITATIONS_CREATE_REVIEW",
  CATALOG_GET_ITEM: "CATALOG_GET_ITEM",
  PRODUCT_PRICING_GET_OFFERS: "PRODUCT_PRICING_GET_OFFERS",
} as const;

export type AmazonSpApiOperation =
  (typeof AmazonSpApiOperation)[keyof typeof AmazonSpApiOperation];

type OperationLimit = {
  rateLimitPerSecond: number;
  burst: number;
};

const OPERATION_LIMITS: Record<AmazonSpApiOperation, OperationLimit> = {
  [AmazonSpApiOperation.ORDERS_SEARCH]: { rateLimitPerSecond: 0.0056, burst: 20 },
  [AmazonSpApiOperation.ORDERS_GET]: { rateLimitPerSecond: 0.5, burst: 30 },
  [AmazonSpApiOperation.FINANCES_LIST_TRANSACTIONS]: {
    rateLimitPerSecond: 0.5,
    burst: 10,
  },
  [AmazonSpApiOperation.INVENTORY_SUMMARIES]: {
    rateLimitPerSecond: 2,
    burst: 2,
  },
  [AmazonSpApiOperation.REPORTS_CREATE]: {
    rateLimitPerSecond: 0.0167,
    burst: 15,
  },
  [AmazonSpApiOperation.REPORTS_GET]: {
    rateLimitPerSecond: 0.0222,
    burst: 10,
  },
  [AmazonSpApiOperation.REPORTS_GET_DOCUMENT]: {
    rateLimitPerSecond: 0.0167,
    burst: 15,
  },
  [AmazonSpApiOperation.SOLICITATIONS_GET_ACTIONS]: {
    rateLimitPerSecond: 1,
    burst: 5,
  },
  [AmazonSpApiOperation.SOLICITATIONS_CREATE_REVIEW]: {
    rateLimitPerSecond: 1,
    burst: 5,
  },
  // Catalog Items API v2022-04-01: 2 req/sec, burst 2
  [AmazonSpApiOperation.CATALOG_GET_ITEM]: {
    rateLimitPerSecond: 2,
    burst: 2,
  },
  // Product Pricing API v2022-05-01 offers: 0.5 req/sec, burst 1
  [AmazonSpApiOperation.PRODUCT_PRICING_GET_OFFERS]: {
    rateLimitPerSecond: 0.5,
    burst: 1,
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

export async function reserveAmazonOperationSlot(
  operation: AmazonSpApiOperation,
  now = new Date(),
) {
  const limit = OPERATION_LIMITS[operation];
  const current = await db.amazonApiQuota.findUnique({ where: { operation } });

  if (current?.nextAllowedAt && current.nextAllowedAt > now) {
    throw new AmazonQuotaCooldownError(operation, current.nextAllowedAt);
  }

  const nextAllowedAt = new Date(now.getTime() + getOperationDelayMs(operation));
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
    parseRetryAfterMs(retryAfterHeader, now) ?? getOperationDelayMs(operation) * 2;
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

export async function getAmazonQuotaSnapshot() {
  return db.amazonApiQuota.findMany({ orderBy: { operation: "asc" } });
}

function getOperationDelayMs(operation: AmazonSpApiOperation) {
  const rate = OPERATION_LIMITS[operation].rateLimitPerSecond;
  return Math.max(250, Math.ceil(1000 / rate));
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
