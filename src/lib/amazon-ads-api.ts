/**
 * Amazon Advertising API client (Sponsored Products MVP).
 *
 * Diferencas em relacao a SP-API:
 * - Endpoint base distinto (advertising-api.amazon.com — regiao NA cobre BR).
 * - Headers obrigatorios: `Authorization: Bearer`, `Amazon-Advertising-API-ClientId`,
 *   `Amazon-Advertising-API-Scope: <profileId>` (excecao: GET /v2/profiles).
 * - LWA usa o mesmo endpoint de token, mas o refresh_token deve ter sido emitido
 *   com scope `advertising::campaign_management`.
 * - Reports v3 retornam URL S3 pre-assinada com payload `GZIP_JSON`.
 */

import { gunzipSync } from "node:zlib";

import {
  adoptObservedRateLimit,
  AmazonSpApiOperation,
  markAmazonOperationRateLimited,
  markAmazonOperationSuccess,
  reserveAmazonOperationSlot,
  type AmazonSpApiOperation as AmazonSpApiOperationType,
} from "@/lib/amazon-rate-limit";

export const ADS_API_ENDPOINTS = {
  NA: "https://advertising-api.amazon.com",
  EU: "https://advertising-api-eu.amazon.com",
  FE: "https://advertising-api-fe.amazon.com",
} as const;

export const ADS_OAUTH_SCOPES = ["advertising::campaign_management"] as const;

export interface AdsAPICredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId?: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = ADS_API_ENDPOINTS.NA;
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

type RequestParams = Record<
  string,
  string | number | boolean | Array<string | number | boolean> | undefined | null
>;

export interface AdsProfile {
  profileId: number;
  countryCode?: string;
  currencyCode?: string;
  dailyBudget?: number;
  timezone?: string;
  accountInfo?: {
    marketplaceStringId?: string;
    sellerStringId?: string;
    type?: string;
    name?: string;
    validPaymentMethod?: boolean;
  };
}

export interface AdsReportRef {
  reportId: string;
  status: string; // PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED
  url?: string | null;
  urlExpiresAt?: string | null;
  generatedAt?: string | null;
  startDate?: string;
  endDate?: string;
  failureReason?: string | null;
  fileSize?: number | null;
  configuration?: Record<string, unknown>;
}

export interface SpAdvertisedProductRow {
  date?: string;
  campaignId?: string | number;
  campaignName?: string;
  adGroupId?: string | number;
  adGroupName?: string;
  advertisedAsin?: string;
  advertisedSku?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  sales7d?: number;
  unitsSoldClicks7d?: number;
  purchases7d?: number;
  acosClicks7d?: number;
  [key: string]: unknown;
}

export interface AdsCampaign {
  campaignId: string | number;
  name: string;
  state?: string;
  targetingType?: string;
  budget?: { budget?: number; budgetType?: string };
  [key: string]: unknown;
}

interface AdsApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: RequestParams;
  body?: unknown;
  accessToken?: string;
  // null = nao envia header de scope (ex: /v2/profiles).
  // string = sobrescreve creds.profileId.
  profileId?: string | null;
  operation?: AmazonSpApiOperationType;
  contentType?: string;
  accept?: string;
}

export async function getAdsLWAToken(
  creds: Pick<AdsAPICredentials, "clientId" | "clientSecret" | "refreshToken">,
): Promise<string> {
  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new Error(
      `Ads LWA token error ${response.status}: ${stringify(payload)}`,
    );
  }

  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    throw new Error(
      `Ads LWA token response without access_token: ${stringify(payload)}`,
    );
  }

  return payload.access_token;
}

export async function adsApiRequest<T = unknown>(
  creds: AdsAPICredentials,
  pathname: string,
  options: AdsApiRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const endpoint = creds.endpoint || DEFAULT_ENDPOINT;
  const accessToken = options.accessToken ?? (await getAdsLWAToken(creds));

  const url = new URL(pathname, endpoint);
  appendParams(url, options.params);

  const profileId =
    options.profileId === null
      ? null
      : options.profileId ?? creds.profileId ?? null;

  if (options.operation) {
    await reserveAmazonOperationSlot(options.operation);
  }

  let lastPayload: unknown = {};
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers: Record<string, string> = {
      accept: options.accept ?? "application/json",
      "user-agent": "erp-amazon/1.0",
      authorization: `Bearer ${accessToken}`,
      "amazon-advertising-api-clientid": creds.clientId,
    };
    if (profileId) headers["amazon-advertising-api-scope"] = String(profileId);
    if (options.body) {
      headers["content-type"] = options.contentType ?? "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await parseResponse(response);
    lastPayload = payload;

    if (options.operation) {
      const observed = response.headers.get("x-amzn-RateLimit-Limit");
      if (observed) await adoptObservedRateLimit(options.operation, observed);
    }

    if (response.ok) {
      if (options.operation) {
        await markAmazonOperationSuccess(options.operation, response.status);
      }
      return payload as T;
    }

    if (
      (response.status === 429 || isQuotaPayload(payload)) &&
      options.operation
    ) {
      const { nextAllowedAt } = await markAmazonOperationRateLimited({
        operation: options.operation,
        status: response.status,
        retryAfterHeader: response.headers.get("retry-after"),
        message: stringify(payload),
      });
      throw new Error(
        `Ads API quota ${options.operation} ate ${nextAllowedAt.toISOString()}: ${stringify(payload)}`,
      );
    }

    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const baseDelayMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 500 * 2 ** attempt;
      await sleep(baseDelayMs + Math.floor(Math.random() * 250));
      continue;
    }

    throw new Error(
      `Ads API ${method} ${url.pathname}${url.search} -> ${response.status}: ${stringify(payload)}`,
    );
  }

  throw new Error(
    `Ads API ${method} ${url.pathname}${url.search} falhou: ${stringify(lastPayload)}`,
  );
}

// ── Profiles ───────────────────────────────────────────────────────────────

export async function listAdsProfiles(creds: AdsAPICredentials): Promise<AdsProfile[]> {
  const profiles = await adsApiRequest<AdsProfile[]>(creds, "/v2/profiles", {
    method: "GET",
    profileId: null,
    operation: AmazonSpApiOperation.ADS_PROFILES_GET,
  });
  return Array.isArray(profiles) ? profiles : [];
}

// ── Reports v3 ─────────────────────────────────────────────────────────────

export interface CreateSpReportInput {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  name?: string;
}

export async function createSpAdvertisedProductReport(
  creds: AdsAPICredentials,
  input: CreateSpReportInput,
): Promise<AdsReportRef> {
  const body = {
    name: input.name ?? `erp-amazon-sp-ads-${input.startDate}-${input.endDate}`,
    startDate: input.startDate,
    endDate: input.endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["advertiser"],
      columns: [
        "date",
        "campaignId",
        "campaignName",
        "adGroupId",
        "adGroupName",
        "advertisedAsin",
        "advertisedSku",
        "impressions",
        "clicks",
        "cost",
        "sales7d",
        "unitsSoldClicks7d",
        "purchases7d",
        "acosClicks7d",
      ],
      reportTypeId: "spAdvertisedProduct",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };

  return adsApiRequest<AdsReportRef>(creds, "/reporting/reports", {
    method: "POST",
    body,
    operation: AmazonSpApiOperation.ADS_REPORTS_CREATE,
    contentType: "application/vnd.createasyncreportrequest.v3+json",
  });
}

export async function getAdsReport(
  creds: AdsAPICredentials,
  reportId: string,
): Promise<AdsReportRef> {
  return adsApiRequest<AdsReportRef>(
    creds,
    `/reporting/reports/${encodeURIComponent(reportId)}`,
    {
      method: "GET",
      operation: AmazonSpApiOperation.ADS_REPORTS_GET,
    },
  );
}

export async function downloadAdsReport(
  url: string,
): Promise<SpAdvertisedProductRow[]> {
  // S3 pre-assinada — sem auth header. Reservamos slot mesmo assim para nao
  // estourar rate interno do worker em corridas concorrentes.
  await reserveAmazonOperationSlot(AmazonSpApiOperation.ADS_REPORTS_DOWNLOAD);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ads report download falhou ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  await markAmazonOperationSuccess(
    AmazonSpApiOperation.ADS_REPORTS_DOWNLOAD,
    response.status,
  );

  const buffer = Buffer.from(await response.arrayBuffer());
  const decompressed = gunzipSync(buffer);
  const text = decompressed.toString("utf8").trim();
  if (!text) return [];

  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as SpAdvertisedProductRow[];
  if (isRecord(parsed) && Array.isArray(parsed.data)) {
    return parsed.data as SpAdvertisedProductRow[];
  }
  return [];
}

// ── Campaigns (Sponsored Products v3) ──────────────────────────────────────

export async function listSponsoredProductsCampaigns(
  creds: AdsAPICredentials,
  options: { nextToken?: string; maxResults?: number } = {},
): Promise<{ campaigns: AdsCampaign[]; nextToken?: string }> {
  const body: Record<string, unknown> = {};
  if (options.maxResults) body.maxResults = options.maxResults;
  if (options.nextToken) body.nextToken = options.nextToken;

  const payload = await adsApiRequest<{
    campaigns?: AdsCampaign[];
    nextToken?: string;
  }>(creds, "/sp/campaigns/list", {
    method: "POST",
    body,
    operation: AmazonSpApiOperation.ADS_CAMPAIGNS_LIST,
    contentType: "application/vnd.spcampaign.v3+json",
    accept: "application/vnd.spcampaign.v3+json",
  });

  return {
    campaigns: payload.campaigns ?? [],
    nextToken: payload.nextToken,
  };
}

// ── Helpers internos ───────────────────────────────────────────────────────

function appendParams(url: URL, params: RequestParams = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuotaPayload(value: unknown) {
  const text = stringify(value).toLowerCase();
  return text.includes("quotaexceeded") || text.includes("quota exceeded");
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
