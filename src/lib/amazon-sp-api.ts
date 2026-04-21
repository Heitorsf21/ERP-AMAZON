/**
 * Amazon SP-API client for a private seller app.
 *
 * Current SP-API requests for this private app use Login with Amazon (LWA)
 * access tokens directly via `x-amz-access-token`. AWS IAM/SigV4 is not
 * required for the flows used here.
 */

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
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const endpoint = creds.endpoint || DEFAULT_ENDPOINT;
  const accessToken = options.accessToken ?? (await getLWAToken(creds));

  const url = new URL(pathname, endpoint);
  appendParams(url, options.params);

  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      "x-amz-access-token": accessToken,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new Error(`SP-API ${method} ${url.pathname} -> ${response.status}: ${stringify(payload)}`);
  }

  return payload as T;
}

export async function getMarketplaceParticipations(creds: SPAPICredentials) {
  return spApiRequest(creds, "/sellers/v1/marketplaceParticipations");
}

export async function getOrders(
  creds: SPAPICredentials,
  lastUpdatedAfter: Date,
  maxResultsPerPage = 20,
): Promise<SPOrder[]> {
  const result = await spApiRequest<SPOrdersResponse>(creds, "/orders/2026-01-01/orders", {
    params: {
      marketplaceIds: creds.marketplaceId,
      lastUpdatedAfter: lastUpdatedAfter.toISOString(),
      maxResultsPerPage,
    },
  });

  return result.orders ?? [];
}

export async function getInventorySummaries(
  creds: SPAPICredentials,
): Promise<SPInventorySummary[]> {
  type InventoryResponse = {
    payload?: {
      inventorySummaries?: SPInventorySummary[];
    };
    inventorySummaries?: SPInventorySummary[];
  };

  const result = await spApiRequest<InventoryResponse>(
    creds,
    "/fba/inventory/v1/summaries",
    {
      params: {
        details: true,
        granularityType: "Marketplace",
        granularityId: creds.marketplaceId,
        marketplaceIds: creds.marketplaceId,
      },
    },
  );

  return result.payload?.inventorySummaries ?? result.inventorySummaries ?? [];
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

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
