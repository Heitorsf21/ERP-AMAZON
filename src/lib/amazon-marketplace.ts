/**
 * Normalização de marketplaces Amazon (Brasil + internacionais).
 *
 * O campo `VendaAmazon.marketplace` é populado em `service.ts` com:
 *   `getOrderMarketplaceName(order) ?? getOrderMarketplace(order, creds.marketplaceId)`
 *
 * Quando o pedido vem com `SalesChannel` preenchido, recebemos algo como
 * `"Amazon.com.br"`. Quando não vem, recebemos apenas o `marketplaceId`
 * cru (ex: `A2Q3Y263D00KWC`). A UI deve mostrar sempre o domínio amigável.
 */

export const AMAZON_MARKETPLACE_NAMES: Record<string, string> = {
  // Américas
  A2Q3Y263D00KWC: "amazon.com.br",
  ATVPDKIKX0DER: "amazon.com",
  A2EUQ1WTGCTBG2: "amazon.ca",
  A1AM78C64UM0Y8: "amazon.com.mx",
  // Europa
  A1F83G8C2ARO7P: "amazon.co.uk",
  A1PA6795UKMFR9: "amazon.de",
  A13V1IB3VIYZZH: "amazon.fr",
  APJ6JRA9NG5V4: "amazon.it",
  A1RKKUPIHCS9HS: "amazon.es",
  A1805IZSGTT6HS: "amazon.nl",
  A2NODRKZP88ZB9: "amazon.se",
  A1C3SOZRARQ6R3: "amazon.pl",
  A33AVAJ2PDY3EV: "amazon.com.tr",
  A17E79C6D8DWNP: "amazon.sa",
  // Ásia-Pacífico
  A21TJRUUN4KGV: "amazon.in",
  A2VIGQ35RCS4UG: "amazon.ae",
  A19VAU5U5O7RUS: "amazon.sg",
  A39IBJ37TRP1C6: "amazon.com.au",
  A1VC38T7YXB528: "amazon.co.jp",
};

/**
 * Default exibido quando o marketplace não veio preenchido. Como este ERP
 * opera exclusivamente o marketplace brasileiro, é seguro assumir BR.
 */
export const MARKETPLACE_PADRAO_BR = "amazon.com.br";

/**
 * Converte um valor cru (`marketplaceId`, `SalesChannel` ou nulo) em um
 * rótulo amigável estável (`amazon.com.br`, `amazon.com`, …).
 *
 * Casos cobertos:
 *  - `null`/`""` → `"amazon.com.br"` (default BR, ERP single-marketplace)
 *  - ID conhecido (`A2Q3Y263D00KWC`) → `"amazon.com.br"`
 *  - já amigável (`"Amazon.com.br"`, `"amazon.com"`) → lower-case
 *  - desconhecido → devolve o valor original (ex: `"Non-Amazon"`)
 */
export function normalizarNomeMarketplace(
  input: string | null | undefined,
): string {
  if (!input) return MARKETPLACE_PADRAO_BR;
  const value = input.trim();
  if (!value) return MARKETPLACE_PADRAO_BR;

  const mapped = AMAZON_MARKETPLACE_NAMES[value];
  if (mapped) return mapped;

  if (/^amazon\./i.test(value)) return value.toLowerCase();

  return value;
}
