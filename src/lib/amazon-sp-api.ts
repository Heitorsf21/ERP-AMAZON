/**
 * Amazon SP-API client for a private seller app.
 *
 * Current SP-API requests for this private app use Login with Amazon (LWA)
 * access tokens directly via `x-amz-access-token`. AWS IAM/SigV4 is not
 * required for the flows used here.
 */

import {
  AmazonSpApiOperation,
  markAmazonOperationRateLimited,
  markAmazonOperationSuccess,
  reserveAmazonOperationSlot,
  type AmazonSpApiOperation as AmazonSpApiOperationType,
} from "@/lib/amazon-rate-limit";

export interface SPAPICredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = "https://sellingpartnerapi-na.amazon.com";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

type RequestParams = Record<
  string,
  string | number | boolean | Array<string | number | boolean> | undefined | null
>;

type PaginationOptions = {
  maxPages?: number;
  accessToken?: string;
  before?: Date;
  dateFilter?: "created" | "lastUpdated";
};

export interface SPOrderProduct {
  asin?: string;
  sellerSku?: string;
  title?: string;
  price?: unknown;
}

export interface SPOrderItem {
  orderItemId: string;
  quantityOrdered: number;
  product?: SPOrderProduct;
}

export interface SPOrder {
  orderId: string;
  createdTime: string;
  lastUpdatedTime: string;
  earliestDeliveryDate?: string;
  latestDeliveryDate?: string;
  EarliestDeliveryDate?: string;
  LatestDeliveryDate?: string;
  orderStatus?: string;
  orderAliases?: Array<{ orderAlias?: string }>;
  salesChannel?: {
    marketplaceId?: string;
    marketplaceName?: string;
    channelName?: string;
  };
  orderItems?: SPOrderItem[];
}

export interface SPOrdersResponse {
  pagination?: {
    nextToken?: string;
  };
  orders: SPOrder[];
  lastUpdatedBefore?: string;
}

export interface SPFinanceTransaction {
  transactionId?: string;
  transactionType?: string;
  transactionStatus?: string;
  description?: string;
  postedDate?: string;
  marketplaceId?: string;
  relatedIdentifiers?: Array<{
    relatedIdentifierName?: string;
    relatedIdentifierValue?: string;
  }>;
  transactionItems?: Array<Record<string, unknown>>;
  breakdowns?: Array<Record<string, unknown>>;
  totalAmount?: unknown;
  [key: string]: unknown;
}

export interface SPInventorySummary {
  asin: string;
  fnSku: string;
  sellerSku: string;
  condition: string;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    reservedQuantity?: { totalReservedQuantity?: number };
  };
  totalQuantity: number;
}

export interface SolicitationAction {
  name?: string;
  href?: string;
  title?: string;
  _links?: {
    self?: { href?: string; name?: string };
    schema?: { href?: string; name?: string };
  };
  _embedded?: unknown;
}

export interface SolicitationActionsResponse {
  _links?: {
    actions?: SolicitationAction[];
    self?: { href?: string };
  };
  _embedded?: {
    actions?: SolicitationAction[];
  };
}

export async function getLWAToken(
  creds: Pick<SPAPICredentials, "clientId" | "clientSecret" | "refreshToken">,
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
    throw new Error(`LWA token error ${response.status}: ${stringify(payload)}`);
  }

  if (!isRecord(payload) || typeof payload.access_token !== "string") {
    throw new Error(`LWA token response without access_token: ${stringify(payload)}`);
  }

  return payload.access_token;
}

export async function spApiRequest<T = unknown>(
  creds: SPAPICredentials,
  pathname: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    params?: RequestParams;
    body?: unknown;
    accessToken?: string;
    operation?: AmazonSpApiOperationType;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const endpoint = creds.endpoint || DEFAULT_ENDPOINT;
  const accessToken = options.accessToken ?? (await getLWAToken(creds));

  const url = new URL(pathname, endpoint);
  appendParams(url, options.params);

  let lastPayload: unknown = {};
  if (options.operation) {
    await reserveAmazonOperationSlot(options.operation);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        "user-agent": "erp-amazon/1.0",
        "x-amz-access-token": accessToken,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await parseResponse(response);
    lastPayload = payload;

    if (response.ok) {
      if (options.operation) {
        await markAmazonOperationSuccess(options.operation, response.status);
      }
      return payload as T;
    }

    if ((response.status === 429 || isQuotaPayload(payload)) && options.operation) {
      const { nextAllowedAt } = await markAmazonOperationRateLimited({
        operation: options.operation,
        status: response.status,
        retryAfterHeader: response.headers.get("retry-after"),
        message: stringify(payload),
      });
      throw new Error(
        `SP-API quota ${options.operation} ate ${nextAllowedAt.toISOString()}: ${stringify(
          payload,
        )}`,
      );
    }

    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const rateLimit = response.headers.get("x-amzn-RateLimit-Limit");
      const baseDelayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt;
      await sleep(baseDelayMs + Math.floor(Math.random() * 250));
      if (rateLimit) {
        console.warn(
          `SP-API rate limit ${rateLimit} em ${url.pathname}; tentativa ${
            attempt + 2
          }/4`,
        );
      }
      continue;
    }

    throw new Error(
      `SP-API ${method} ${url.pathname}${url.search} -> ${
        response.status
      }: ${stringify(payload)}`,
    );
  }

  throw new Error(
    `SP-API ${method} ${url.pathname}${url.search} falhou: ${stringify(
      lastPayload,
    )}`,
  );
}

export interface SPCatalogSummary {
  marketplaceId?: string;
  itemName?: string;
  brand?: string;
  productType?: string;
}

export interface SPCatalogImage {
  variant?: string;
  link?: string;
  height?: number;
  width?: number;
}

export interface SPCatalogClassification {
  displayName?: string;
  classificationId?: string;
}

export interface SPCatalogItem {
  asin: string;
  summaries?: SPCatalogSummary[];
  images?: Array<{
    marketplaceId?: string;
    images?: SPCatalogImage[];
  }>;
  classifications?: Array<{
    marketplaceId?: string;
    classifications?: SPCatalogClassification[];
  }>;
}

export interface SPProductOfferListing {
  sellerId?: string;
  isBuyBoxWinner?: boolean;
  listingPrice?: { amount?: number; currencyCode?: string };
  shippingPrice?: { amount?: number; currencyCode?: string };
  condition?: { value?: string };
  fulfillmentChannel?: string;
}

export interface SPProductOffersResponse {
  asin?: string;
  marketplaceId?: string;
  offers?: SPProductOfferListing[];
  summary?: {
    numberOfOffers?: Array<{
      condition?: string;
      fulfillmentChannel?: string;
      offerCount?: number;
    }>;
    buyBoxEligibleOffers?: Array<{
      condition?: string;
      fulfillmentChannel?: string;
      offerCount?: number;
    }>;
    buyBoxPrices?: Array<{
      condition?: string;
      listingPrice?: { amount?: number; currencyCode?: string };
      landedPrice?: { amount?: number; currencyCode?: string };
    }>;
    lowestPrices?: Array<{
      condition?: string;
      fulfillmentChannel?: string;
      listingPrice?: { amount?: number; currencyCode?: string };
    }>;
  };
}

export interface SPReport {
  reportId: string;
  reportType?: string;
  processingStatus?: string; // IN_QUEUE | IN_PROGRESS | DONE | FATAL | CANCELLED
  reportDocumentId?: string;
  dataStartTime?: string;
  dataEndTime?: string;
  createdTime?: string;
}

export interface SPReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string; // "GZIP"
}

export async function getSettlementReports(
  creds: SPAPICredentials,
  maxPages = 3,
): Promise<SPReport[]> {
  type ReportsListResponse = {
    reports?: SPReport[];
    nextToken?: string;
  };

  const reports: SPReport[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  do {
    const result = await spApiRequest<ReportsListResponse>(
      creds,
      "/reports/2021-06-30/reports",
      {
        operation: AmazonSpApiOperation.REPORTS_GET,
        params: nextToken
          ? { nextToken }
          : {
              reportTypes: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE",
              pageSize: 10,
            },
      },
    );
    reports.push(...(result.reports ?? []));
    nextToken = result.nextToken;
    pages += 1;
  } while (nextToken && pages < maxPages);

  return reports;
}

export async function getReportDocument(
  creds: SPAPICredentials,
  reportDocumentId: string,
): Promise<SPReportDocument | null> {
  try {
    return await spApiRequest<SPReportDocument>(
      creds,
      `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
      { operation: AmazonSpApiOperation.REPORTS_GET_DOCUMENT },
    );
  } catch {
    return null;
  }
}

export async function getMarketplaceParticipations(creds: SPAPICredentials) {
  return spApiRequest(creds, "/sellers/v1/marketplaceParticipations");
}

export async function getCatalogItem(
  creds: SPAPICredentials,
  asin: string,
): Promise<SPCatalogItem | null> {
  type CatalogResponse = SPCatalogItem | { item?: SPCatalogItem };
  try {
    const result = await spApiRequest<CatalogResponse>(
      creds,
      `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
      {
        operation: AmazonSpApiOperation.CATALOG_GET_ITEM,
        params: {
          marketplaceIds: creds.marketplaceId,
          includedData: "summaries,images,classifications",
        },
      },
    );
    if ("item" in result && result.item) return result.item;
    return result as SPCatalogItem;
  } catch {
    return null;
  }
}

export async function getProductOffers(
  creds: SPAPICredentials,
  asin: string,
): Promise<SPProductOffersResponse | null> {
  type OffersResponse = SPProductOffersResponse | { payload?: SPProductOffersResponse };
  try {
    const result = await spApiRequest<OffersResponse>(
      creds,
      `/products/pricing/v2022-05-01/items/${encodeURIComponent(asin)}/offers`,
      {
        operation: AmazonSpApiOperation.PRODUCT_PRICING_GET_OFFERS,
        params: {
          marketplaceId: creds.marketplaceId,
          itemCondition: "New",
          customerType: "Consumer",
        },
      },
    );
    if ("payload" in result && result.payload) return result.payload;
    return result as SPProductOffersResponse;
  } catch {
    return null;
  }
}

export async function getOrders(
  creds: SPAPICredentials,
  after: Date,
  maxResultsPerPage = 20,
  options: PaginationOptions = {},
): Promise<SPOrder[]> {
  const orders: SPOrder[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  do {
    const result = await spApiRequest<SPOrdersResponse>(
      creds,
      "/orders/2026-01-01/orders",
      {
        operation: AmazonSpApiOperation.ORDERS_SEARCH,
        accessToken: options.accessToken,
        params: nextToken
          ? {
              ...orderDateParams(
                creds.marketplaceId,
                after,
                options.before,
                maxResultsPerPage,
                options.dateFilter ?? "created",
              ),
              nextToken,
            }
          : orderDateParams(
              creds.marketplaceId,
              after,
              options.before,
              maxResultsPerPage,
              options.dateFilter ?? "created",
            ),
      },
    );

    orders.push(...(result.orders ?? []));
    nextToken = result.pagination?.nextToken;
    pages += 1;
  } while (nextToken && (!options.maxPages || pages < options.maxPages));

  return orders;
}

export async function listFinancialTransactions(
  creds: SPAPICredentials,
  postedAfter: Date,
  postedBefore?: Date,
  maxResultsPerPage = 100,
  options: PaginationOptions = {},
): Promise<SPFinanceTransaction[]> {
  type TransactionsResponse = {
    transactions?: SPFinanceTransaction[];
    payload?: {
      transactions?: SPFinanceTransaction[];
      nextToken?: string;
      pagination?: { nextToken?: string };
    };
    pagination?: { nextToken?: string };
    nextToken?: string;
  };

  const transactions: SPFinanceTransaction[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  do {
    const result = await spApiRequest<TransactionsResponse>(
      creds,
      "/finances/2024-06-19/transactions",
      {
        operation: AmazonSpApiOperation.FINANCES_LIST_TRANSACTIONS,
        accessToken: options.accessToken,
        params: nextToken
          ? { nextToken }
          : {
              marketplaceId: creds.marketplaceId,
              postedAfter: postedAfter.toISOString(),
              postedBefore: postedBefore?.toISOString(),
              maxResultsPerPage,
            },
      },
    );

    transactions.push(...(result.payload?.transactions ?? result.transactions ?? []));
    nextToken =
      result.payload?.pagination?.nextToken ??
      result.payload?.nextToken ??
      result.pagination?.nextToken ??
      result.nextToken;
    pages += 1;
  } while (nextToken && (!options.maxPages || pages < options.maxPages));

  return transactions;
}

export async function getInventorySummaries(
  creds: SPAPICredentials,
  options: PaginationOptions = {},
): Promise<SPInventorySummary[]> {
  type InventoryResponse = {
    payload?: {
      inventorySummaries?: SPInventorySummary[];
      pagination?: { nextToken?: string };
    };
    inventorySummaries?: SPInventorySummary[];
    pagination?: { nextToken?: string };
  };

  const summaries: SPInventorySummary[] = [];
  let nextToken: string | undefined;
  let pages = 0;

  do {
    const result = await spApiRequest<InventoryResponse>(
      creds,
      "/fba/inventory/v1/summaries",
      {
        operation: AmazonSpApiOperation.INVENTORY_SUMMARIES,
        accessToken: options.accessToken,
        params: nextToken
          ? { nextToken }
          : {
              details: true,
              granularityType: "Marketplace",
              granularityId: creds.marketplaceId,
              marketplaceIds: creds.marketplaceId,
            },
      },
    );

    summaries.push(...(result.payload?.inventorySummaries ?? result.inventorySummaries ?? []));
    nextToken =
      result.payload?.pagination?.nextToken ?? result.pagination?.nextToken;
    pages += 1;
  } while (nextToken && (!options.maxPages || pages < options.maxPages));

  return summaries;
}

export async function getSolicitationActionsForOrder(
  creds: SPAPICredentials,
  amazonOrderId: string,
): Promise<{
  response: SolicitationActionsResponse;
  canRequestReview: boolean;
}> {
  const response = await spApiRequest<SolicitationActionsResponse>(
    creds,
    `/solicitations/v1/orders/${encodeURIComponent(amazonOrderId)}`,
    {
      operation: AmazonSpApiOperation.SOLICITATIONS_GET_ACTIONS,
      params: {
        marketplaceIds: creds.marketplaceId,
      },
    },
  );

  return {
    response,
    canRequestReview: hasProductReviewAndSellerFeedbackAction(response),
  };
}

export async function createProductReviewAndSellerFeedbackSolicitation(
  creds: SPAPICredentials,
  amazonOrderId: string,
): Promise<unknown> {
  return spApiRequest(
    creds,
    `/solicitations/v1/orders/${encodeURIComponent(
      amazonOrderId,
    )}/solicitations/productReviewAndSellerFeedback`,
    {
      method: "POST",
      operation: AmazonSpApiOperation.SOLICITATIONS_CREATE_REVIEW,
      params: {
        marketplaceIds: creds.marketplaceId,
      },
    },
  );
}

export function hasProductReviewAndSellerFeedbackAction(
  response: SolicitationActionsResponse,
): boolean {
  const linkedActions = normalizeActions(response._links?.actions);
  const embeddedActions = normalizeActions(response._embedded?.actions);
  return [...linkedActions, ...embeddedActions].some(
    (action) =>
      action.name === "productReviewAndSellerFeedback" ||
      action._links?.self?.name === "productReviewAndSellerFeedback" ||
      action._links?.schema?.name === "productReviewAndSellerFeedback",
  );
}

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

function orderDateParams(
  marketplaceId: string,
  after: Date,
  before: Date | undefined,
  maxResultsPerPage: number,
  dateFilter: "created" | "lastUpdated",
): RequestParams {
  const params: RequestParams = {
    marketplaceIds: marketplaceId,
    maxResultsPerPage,
  };

  if (dateFilter === "lastUpdated") {
    params.lastUpdatedAfter = after.toISOString();
    params.lastUpdatedBefore = before?.toISOString();
  } else {
    params.createdAfter = after.toISOString();
    params.createdBefore = before?.toISOString();
  }

  return params;
}

function normalizeActions(actions?: SolicitationAction | SolicitationAction[]) {
  if (!actions) return [];
  return Array.isArray(actions) ? actions : [actions];
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
