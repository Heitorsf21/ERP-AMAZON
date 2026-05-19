export type AmazonMoneyLike = {
  Amount?: string | number | null;
  amount?: string | number | null;
  value?: string | number | null;
  value_with_tax?: string | number | null;
  Value?: string | number | null;
};

export type AmazonOrderItemPriceInput = {
  ItemPrice?: AmazonMoneyLike | null;
  itemPrice?: AmazonMoneyLike | null;
  price?: AmazonMoneyLike | string | number | null;
  PromotionDiscount?: AmazonMoneyLike | null;
  promotionDiscount?: AmazonMoneyLike | null;
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
