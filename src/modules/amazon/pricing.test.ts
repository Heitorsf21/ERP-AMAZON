import { describe, expect, it } from "vitest";
import {
  calcularValorBrutoOrderItemCentavos,
  extractAmazonListingEffectivePriceCentavos,
} from "./pricing";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function listingWithPrices(input: {
  discountedSchedule?: Record<string, unknown>;
  ourPrice?: number;
}) {
  return {
    attributes: {
      purchasable_offer: [
        {
          discounted_price: input.discountedSchedule
            ? [{ schedule: [input.discountedSchedule] }]
            : undefined,
          our_price: [
            {
              schedule: [
                {
                  value_with_tax: input.ourPrice ?? 89.99,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("extractAmazonListingEffectivePriceCentavos", () => {
  it("prefere discounted_price ativo", () => {
    const listing = listingWithPrices({
      discountedSchedule: {
        value_with_tax: 70.97,
        start_at: "2026-05-18T00:00:00.000Z",
        end_at: "2026-05-20T23:59:59.000Z",
      },
    });

    expect(extractAmazonListingEffectivePriceCentavos(listing, NOW)).toBe(7097);
  });

  it("ignora discounted_price futuro e usa our_price", () => {
    const listing = listingWithPrices({
      discountedSchedule: {
        value_with_tax: 70.97,
        start_at: "2026-05-20T00:00:00.000Z",
        end_at: "2026-05-25T23:59:59.000Z",
      },
      ourPrice: 89.99,
    });

    expect(extractAmazonListingEffectivePriceCentavos(listing, NOW)).toBe(8999);
  });

  it("ignora discounted_price expirado e usa our_price", () => {
    const listing = listingWithPrices({
      discountedSchedule: {
        value_with_tax: 70.97,
        start_at: "2026-05-10T00:00:00.000Z",
        end_at: "2026-05-18T23:59:59.000Z",
      },
      ourPrice: 89.99,
    });

    expect(extractAmazonListingEffectivePriceCentavos(listing, NOW)).toBe(8999);
  });

  it("usa our_price quando nao existe discounted_price", () => {
    const listing = listingWithPrices({ ourPrice: 89.99 });

    expect(extractAmazonListingEffectivePriceCentavos(listing, NOW)).toBe(8999);
  });
});

describe("calcularValorBrutoOrderItemCentavos", () => {
  it("desconta PromotionDiscount do ItemPrice", () => {
    expect(
      calcularValorBrutoOrderItemCentavos({
        ItemPrice: { Amount: "89.99" },
        PromotionDiscount: { Amount: "19.02" },
      }),
    ).toBe(7097);
  });

  it("mantem ItemPrice quando nao ha PromotionDiscount", () => {
    expect(
      calcularValorBrutoOrderItemCentavos({
        ItemPrice: { Amount: "89.99" },
      }),
    ).toBe(8999);
  });

  it("retorna zero quando PromotionDiscount supera ItemPrice", () => {
    expect(
      calcularValorBrutoOrderItemCentavos({
        ItemPrice: { Amount: "10.00" },
        PromotionDiscount: { Amount: "20.00" },
      }),
    ).toBe(0);
  });
});
