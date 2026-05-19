export type AmazonMoneyLike = {
  Amount?: string | number | null;
  amount?: string | number | null;
  value?: string | number | null;
  value_with_tax?: string | number | null;
  Value?: string | number | null;
  CurrencyCode?: string | null;
  currencyCode?: string | null;
  currency?: string | null;
};

export type AmazonOrderItemPriceInput = {
  ItemPrice?: AmazonMoneyLike | null;
  itemPrice?: AmazonMoneyLike | null;
  price?: AmazonMoneyLike | string | number | null;
  PromotionDiscount?: AmazonMoneyLike | null;
  promotionDiscount?: AmazonMoneyLike | null;
};

export type AmazonOrderItemMergeInput = AmazonOrderItemPriceInput & {
  ASIN?: string | null;
  asin?: string | null;
  SellerSKU?: string | null;
  sellerSku?: string | null;
  sku?: string | null;
  OrderItemId?: string | null;
  orderItemId?: string | null;
  Title?: string | null;
  title?: string | null;
  QuantityOrdered?: number | string | null;
  quantityOrdered?: number | string | null;
  quantity?: number | string | null;
  ShippingPrice?: AmazonMoneyLike | null;
  shippingPrice?: AmazonMoneyLike | null;
  ItemTax?: AmazonMoneyLike | null;
  itemTax?: AmazonMoneyLike | null;
  ShippingTax?: AmazonMoneyLike | null;
  shippingTax?: AmazonMoneyLike | null;
};

export function moneyToCentavos(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return 0;
    const decimal =
      normalized.includes(",") && !normalized.includes(".")
        ? normalized.replace(".", "").replace(",", ".")
        : normalized.replace(/,/g, "");
    const parsed = Number(decimal.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  if (isRecord(value)) {
    const amount =
      value.value_with_tax ??
      value.Amount ??
      value.amount ??
      value.value ??
      value.Value;
    if (amount !== undefined) return moneyToCentavos(amount);
  }
  return 0;
}

export function calcularValorBrutoOrderItemCentavos(
  item: AmazonOrderItemPriceInput,
): number {
  const itemPrice = moneyToCentavos(
    item.ItemPrice ?? item.itemPrice ?? item.price,
  );
  if (itemPrice <= 0) return 0;

  const desconto = Math.max(
    0,
    moneyToCentavos(item.PromotionDiscount ?? item.promotionDiscount),
  );
  return Math.max(0, itemPrice - desconto);
}

export function mergeAmazonOrderItemsWithSummary<
  T extends AmazonOrderItemMergeInput,
>(
  detalhes: T[],
  resumo: AmazonOrderItemMergeInput[],
): Array<T & AmazonOrderItemMergeInput> {
  if (detalhes.length === 0) return resumo as Array<T & AmazonOrderItemMergeInput>;
  if (resumo.length === 0) return detalhes;

  const usados = new Set<number>();
  const merged = detalhes.map((detalhe) => {
    const matchIndex = resumo.findIndex(
      (candidate, index) =>
        !usados.has(index) && orderItemsMatch(detalhe, candidate),
    );
    if (matchIndex < 0) return detalhe;

    usados.add(matchIndex);
    return mergeOrderItem(detalhe, resumo[matchIndex]!) as T;
  });

  for (let index = 0; index < resumo.length; index += 1) {
    if (!usados.has(index)) merged.push(resumo[index] as T);
  }

  return merged;
}

export function extractAmazonListingEffectivePriceCentavos(
  item: unknown,
  now = new Date(),
): number | null {
  const attrs = isRecord(item) && isRecord(item.attributes)
    ? item.attributes
    : null;
  if (!attrs) return null;

  const offers = toArray(attrs.purchasable_offer);
  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const descontoAtivo = extractScheduledPriceCentavos(
      offer.discounted_price,
      now,
      true,
    );
    if (descontoAtivo != null) return descontoAtivo;
  }

  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const ourPrice = extractScheduledPriceCentavos(offer.our_price, now, false);
    if (ourPrice != null) return ourPrice;
  }

  return null;
}

function extractScheduledPriceCentavos(
  value: unknown,
  now: Date,
  requireActive: boolean,
): number | null {
  for (const price of toArray(value)) {
    if (!isRecord(price)) continue;
    const schedules = toArray(price.schedule);
    const candidates = schedules.length > 0 ? schedules : [price];

    for (const schedule of candidates) {
      if (!isRecord(schedule)) continue;
      if (requireActive && !isScheduleActive(schedule, now)) continue;
      const centavos = moneyToCentavos(schedule);
      if (centavos > 0) return centavos;
    }
  }

  return null;
}

function mergeOrderItem<T extends AmazonOrderItemMergeInput>(
  detalhe: T,
  resumo: AmazonOrderItemMergeInput,
): AmazonOrderItemMergeInput {
  const semPrecoNoDetalhe = calcularValorBrutoOrderItemCentavos(detalhe) <= 0;
  const resumoTemPreco = calcularValorBrutoOrderItemCentavos(resumo) > 0;

  return {
    ...detalhe,
    ASIN: detalhe.ASIN ?? detalhe.asin ?? resumo.ASIN ?? resumo.asin ?? null,
    SellerSKU:
      detalhe.SellerSKU ??
      detalhe.sellerSku ??
      detalhe.sku ??
      resumo.SellerSKU ??
      resumo.sellerSku ??
      resumo.sku ??
      null,
    OrderItemId:
      detalhe.OrderItemId ?? detalhe.orderItemId ?? resumo.OrderItemId ?? resumo.orderItemId ?? null,
    Title: detalhe.Title ?? detalhe.title ?? resumo.Title ?? resumo.title ?? null,
    QuantityOrdered:
      detalhe.QuantityOrdered ??
      detalhe.quantityOrdered ??
      detalhe.quantity ??
      resumo.QuantityOrdered ??
      resumo.quantityOrdered ??
      resumo.quantity ??
      null,
    ItemPrice:
      semPrecoNoDetalhe && resumoTemPreco
        ? resumo.ItemPrice ?? resumo.itemPrice ?? resumo.price ?? null
        : detalhe.ItemPrice ?? detalhe.itemPrice ?? detalhe.price ?? null,
    PromotionDiscount:
      detalhe.PromotionDiscount ??
      detalhe.promotionDiscount ??
      resumo.PromotionDiscount ??
      resumo.promotionDiscount ??
      null,
    ShippingPrice:
      detalhe.ShippingPrice ?? detalhe.shippingPrice ?? resumo.ShippingPrice ?? resumo.shippingPrice ?? null,
    ItemTax: detalhe.ItemTax ?? detalhe.itemTax ?? resumo.ItemTax ?? resumo.itemTax ?? null,
    ShippingTax:
      detalhe.ShippingTax ?? detalhe.shippingTax ?? resumo.ShippingTax ?? resumo.shippingTax ?? null,
  };
}

function orderItemsMatch(
  left: AmazonOrderItemMergeInput,
  right: AmazonOrderItemMergeInput,
): boolean {
  const leftOrderItemId = normalizedString(left.OrderItemId ?? left.orderItemId);
  const rightOrderItemId = normalizedString(right.OrderItemId ?? right.orderItemId);
  if (leftOrderItemId && rightOrderItemId) return leftOrderItemId === rightOrderItemId;

  const leftSku = normalizedString(left.SellerSKU ?? left.sellerSku ?? left.sku);
  const rightSku = normalizedString(right.SellerSKU ?? right.sellerSku ?? right.sku);
  const leftAsin = normalizedString(left.ASIN ?? left.asin);
  const rightAsin = normalizedString(right.ASIN ?? right.asin);

  if (leftSku && rightSku && leftSku === rightSku) return true;
  return Boolean(leftAsin && rightAsin && leftAsin === rightAsin);
}

function normalizedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isScheduleActive(schedule: Record<string, unknown>, now: Date): boolean {
  const start = readDate(schedule, [
    "start_at",
    "startAt",
    "start_date",
    "startDate",
  ]);
  const end = readDate(schedule, ["end_at", "endAt", "end_date", "endDate"]);
  const time = now.getTime();
  if (start && start.getTime() > time) return false;
  if (end && end.getTime() < time) return false;
  return true;
}

function readDate(
  record: Record<string, unknown>,
  keys: string[],
): Date | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return null;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
