import type {
  SPProductOfferListing,
  SPProductOffersResponse,
} from "@/lib/amazon-sp-api";

type MoneyLike = {
  amount?: number | string | null;
  Amount?: number | string | null;
};

type SummaryLike = NonNullable<
  SPProductOffersResponse["summary"] | SPProductOffersResponse["Summary"]
>;

export type ProductOfferSnapshot = {
  buyboxPriceCentavos: number | null;
  sellerBuybox: string | null;
  numeroOfertas: number | null;
  somosBuybox: boolean | null;
};

export function extractProductOfferSnapshot(
  offersResponse: SPProductOffersResponse,
  ourSellerId?: string | null,
  ourPriceCentavos?: number | null,
): ProductOfferSnapshot {
  const offers = getOffersList(offersResponse);
  const summary = getSummary(offersResponse);
  const buyboxOffer = offers.find(isBuyBoxWinner);
  const buyboxSummaryPrice = getSummaryList(summary, "buyBoxPrices", "BuyBoxPrices")
    .find(isConditionNew) ?? getSummaryList(summary, "buyBoxPrices", "BuyBoxPrices")[0];

  const buyboxPriceCentavos =
    getOfferPriceCentavos(buyboxOffer) ?? getSummaryPriceCentavos(buyboxSummaryPrice);
  const sellerBuybox = buyboxOffer ? getOfferSellerId(buyboxOffer) : null;
  const numeroOfertas = getNumeroOfertas(summary, offers.length);

  let somosBuybox: boolean | null = null;
  if (ourSellerId && sellerBuybox) {
    somosBuybox = sellerBuybox === ourSellerId;
  } else if (buyboxOffer && ourPriceCentavos && buyboxPriceCentavos != null) {
    somosBuybox = Math.abs(buyboxPriceCentavos - ourPriceCentavos) <= 50;
  }

  return {
    buyboxPriceCentavos,
    sellerBuybox,
    numeroOfertas,
    somosBuybox,
  };
}

export function getOffersList(
  offersResponse: SPProductOffersResponse,
): SPProductOfferListing[] {
  return offersResponse.offers ?? offersResponse.Offers ?? [];
}

export function getOfferSellerId(offer: SPProductOfferListing): string | null {
  return offer.sellerId ?? offer.SellerId ?? null;
}

export function isBuyBoxWinner(offer: SPProductOfferListing): boolean {
  return offer.isBuyBoxWinner ?? offer.IsBuyBoxWinner ?? false;
}

export function getOfferPriceCentavos(
  offer: SPProductOfferListing | undefined,
): number | null {
  if (!offer) return null;
  return (
    moneyToCentavos(offer.listingPrice ?? offer.ListingPrice) ??
    moneyToCentavos(offer.landedPrice ?? offer.LandedPrice)
  );
}

function getSummary(offersResponse: SPProductOffersResponse): SummaryLike | null {
  return offersResponse.summary ?? offersResponse.Summary ?? null;
}

function getSummaryList<T extends Record<string, unknown>>(
  summary: SummaryLike | null,
  lowerKey: string,
  upperKey: string,
): T[] {
  if (!summary) return [];
  const record = summary as Record<string, unknown>;
  const value = record[lowerKey] ?? record[upperKey];
  return Array.isArray(value) ? (value as T[]) : [];
}

function getSummaryPriceCentavos(price: Record<string, unknown> | undefined) {
  if (!price) return null;
  return (
    moneyToCentavos(price.listingPrice ?? price.ListingPrice) ??
    moneyToCentavos(price.landedPrice ?? price.LandedPrice)
  );
}

function getNumeroOfertas(summary: SummaryLike | null, offersLength: number) {
  const eligible = getSummaryList(summary, "buyBoxEligibleOffers", "BuyBoxEligibleOffers");
  const totalEligible = sumOfferCounts(eligible);
  if (totalEligible > 0) return totalEligible;

  const allOffers = getSummaryList(summary, "numberOfOffers", "NumberOfOffers");
  const totalOffers = sumOfferCounts(allOffers);
  if (totalOffers > 0) return totalOffers;

  return offersLength > 0 ? offersLength : null;
}

function sumOfferCounts(rows: Array<Record<string, unknown>>) {
  return rows.reduce((sum, row) => {
    const value = row.offerCount ?? row.OfferCount;
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function isConditionNew(row: Record<string, unknown>) {
  const condition = String(row.condition ?? row.Condition ?? "").toLowerCase();
  return condition === "new" || condition === "novo";
}

function moneyToCentavos(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const money = value as MoneyLike;
  const amount = money.amount ?? money.Amount;
  if (amount == null) return null;
  const parsed =
    typeof amount === "number"
      ? amount
      : Number(amount.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}
