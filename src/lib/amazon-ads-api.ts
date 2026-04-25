/**
 * Amazon Advertising API — preparação para integração futura.
 *
 * STATUS: a aplicação ainda NÃO está aprovada pela Amazon Ads API.
 * Este arquivo existe somente para que, quando a aprovação chegar, a
 * integração possa ser plugada sem reescrever a página /publicidade.
 *
 * Hoje, todos os dados de campanhas vêm de CSVs importados manualmente
 * (ver `src/app/api/ads/importar-campanha/route.ts`).
 *
 * Documentação Amazon Ads API:
 *   - https://advertising.amazon.com/API/docs/en-us/getting-started/overview
 *   - https://advertising.amazon.com/API/docs/en-us/reference/api-overview
 *
 * Scopes OAuth2 obrigatórios (LWA — Login with Amazon):
 *   - `advertising::campaign_management`  → ler/criar/editar campanhas
 *   - `advertising::test:create_account`  → opcional, contas sandbox
 *
 * Endpoints regionais:
 *   - NA  → https://advertising-api.amazon.com
 *   - EU  → https://advertising-api-eu.amazon.com
 *   - FE  → https://advertising-api-fe.amazon.com
 *
 * O Brasil cai na região NA (mesma usada pelos marketplaces América).
 */

export const ADS_API_ENDPOINTS = {
  NA: "https://advertising-api.amazon.com",
  EU: "https://advertising-api-eu.amazon.com",
  FE: "https://advertising-api-fe.amazon.com",
} as const;

export const ADS_API_VERSIONS = {
  // Sponsored Products v3 (recomendado, GraphQL-like via JSON)
  sponsoredProducts: "v3",
  // Reports v3 — async report generation
  reports: "v3",
  // Profiles (perfis = combinação account+marketplace)
  profiles: "v2",
} as const;

export const ADS_OAUTH_SCOPES = [
  "advertising::campaign_management",
] as const;

export type AdsApiCredentials = {
  /** LWA Client ID (mesmo client da SP-API ou um separado, conforme cadastro). */
  clientId: string;
  /** LWA Client Secret. */
  clientSecret: string;
  /** Refresh token gerado após o consent flow do anunciante. */
  refreshToken: string;
  /** Profile ID do anunciante (vem de GET /v2/profiles após login). */
  profileId: string;
  /** Região do anunciante. */
  regiao: keyof typeof ADS_API_ENDPOINTS;
};

export type AdsCampaignFromApi = {
  campaignId: string;
  name: string;
  campaignType: "sponsoredProducts" | "sponsoredBrands" | "sponsoredDisplay";
  targetingType: "manual" | "auto";
  state: "enabled" | "paused" | "archived";
  dailyBudget: number;
  startDate: string; // YYYYMMDD
  endDate?: string;
  // Métricas (vêm do report, não do GET de campanha):
  impressions?: number;
  clicks?: number;
  cost?: number; // em moeda local (não centavos)
  attributedSales7d?: number;
  attributedConversions7d?: number;
  acos?: number;
  roas?: number;
};

/**
 * Esqueleto de chamada à API. Não implementado — quando habilitar:
 *   1. Trocar refresh_token por access_token via LWA.
 *   2. Adicionar headers: Authorization, Amazon-Advertising-API-ClientId,
 *      Amazon-Advertising-API-Scope (= profileId).
 *   3. Tratar throttling (429) com backoff exponencial.
 *   4. Para reports: criar (POST), aguardar status SUCCESS, baixar gz.
 */
export async function adsApiRequest<T = unknown>(_options: {
  credenciais: AdsApiCredentials;
  caminho: string;
  metodo?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}): Promise<T> {
  throw new Error(
    "Amazon Ads API ainda não habilitada. Importe relatórios CSV manualmente.",
  );
}
