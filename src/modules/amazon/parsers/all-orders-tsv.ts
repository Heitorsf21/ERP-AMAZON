// Parser do report `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL`.
// Amazon entrega TSV (tab-separated) com header na 1ª linha.
// Campos típicos: amazon-order-id, merchant-order-id, purchase-date, order-status,
//   sales-channel, fulfillment-channel, sku, asin, item-status, quantity,
//   currency, item-price, item-tax, shipping-price, shipping-tax, gift-wrap-price,
//   gift-wrap-tax, item-promotion-discount, ship-promotion-discount, product-name.

export interface AllOrdersTsvRow {
  amazonOrderId: string;
  purchaseDate: Date | null;
  orderStatus: string;
  salesChannel: string | null;
  fulfillmentChannel: string | null;
  sku: string;
  asin: string | null;
  productName: string | null;
  quantity: number;
  itemPriceCentavos: number;
  itemTaxCentavos: number;
  shippingPriceCentavos: number;
  shippingTaxCentavos: number;
  itemPromotionDiscountCentavos: number;
  shipPromotionDiscountCentavos: number;
}

function parseAmountCentavos(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  // Amazon usa "." como separador decimal nesse report (en-US), mas alguns mercados
  // podem retornar "," — aceitar ambos.
  const decimal =
    trimmed.includes(",") && !trimmed.includes(".")
      ? trimmed.replace(",", ".")
      : trimmed;
  const n = Number(decimal.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function parseAllOrdersTsv(input: Buffer | string): AllOrdersTsvRow[] {
  // Remove BOM se presente.
  let text = typeof input === "string" ? input : input.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = lines[0]!.split("\t").map((h) => h.trim().toLowerCase());
  const idx = (key: string) => header.indexOf(key);
  const I = {
    orderId: idx("amazon-order-id"),
    purchaseDate: idx("purchase-date"),
    orderStatus: idx("order-status"),
    salesChannel: idx("sales-channel"),
    fulfillmentChannel: idx("fulfillment-channel"),
    sku: idx("sku"),
    asin: idx("asin"),
    productName: idx("product-name"),
    quantity: idx("quantity"),
    itemPrice: idx("item-price"),
    itemTax: idx("item-tax"),
    shippingPrice: idx("shipping-price"),
    shippingTax: idx("shipping-tax"),
    itemPromo: idx("item-promotion-discount"),
    shipPromo: idx("ship-promotion-discount"),
  };

  if (I.orderId < 0 || I.sku < 0) {
    throw new Error(
      `Header inválido em ALL_ORDERS report: faltam amazon-order-id ou sku. Header recebido: ${header.join(", ")}`,
    );
  }

  const rows: AllOrdersTsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i]!.split("\t");
    const orderId = (cols[I.orderId] ?? "").trim();
    const sku = (cols[I.sku] ?? "").trim();
    if (!orderId || !sku) continue;

    rows.push({
      amazonOrderId: orderId,
      purchaseDate: parseDateOrNull(cols[I.purchaseDate]),
      orderStatus: (cols[I.orderStatus] ?? "").trim() || "UNKNOWN",
      salesChannel: (cols[I.salesChannel] ?? "").trim() || null,
      fulfillmentChannel: (cols[I.fulfillmentChannel] ?? "").trim() || null,
      sku,
      asin: (cols[I.asin] ?? "").trim() || null,
      productName: (cols[I.productName] ?? "").trim() || null,
      quantity: Math.max(1, Number((cols[I.quantity] ?? "1").trim()) || 1),
      itemPriceCentavos: parseAmountCentavos(cols[I.itemPrice]),
      itemTaxCentavos: parseAmountCentavos(cols[I.itemTax]),
      shippingPriceCentavos: parseAmountCentavos(cols[I.shippingPrice]),
      shippingTaxCentavos: parseAmountCentavos(cols[I.shippingTax]),
      itemPromotionDiscountCentavos: parseAmountCentavos(cols[I.itemPromo]),
      shipPromotionDiscountCentavos: parseAmountCentavos(cols[I.shipPromo]),
    });
  }

  return rows;
}
