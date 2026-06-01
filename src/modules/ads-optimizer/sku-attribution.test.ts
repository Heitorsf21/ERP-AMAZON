import { describe, expect, it } from "vitest";
import { resolveSkuAttribution, type ProductAdForSkuAttribution } from "./sku-attribution";

const activeAd: ProductAdForSkuAttribution = {
  campaignId: "camp-1",
  adGroupId: "ag-1",
  adId: "ad-1",
  sku: "SKU-1",
  asin: "ASIN-1",
  estado: "ENABLED",
};

describe("resolveSkuAttribution", () => {
  it("uses the report SKU when Amazon sends it directly", () => {
    const result = resolveSkuAttribution(
      { sku: "SKU-REPORT", asin: "ASIN-REPORT", campaignId: "camp-1", adGroupId: "ag-1" },
      [activeAd],
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      source: "REPORT",
      sku: "SKU-REPORT",
      asin: "ASIN-REPORT",
      blockedReason: null,
    });
  });

  it("resolves by single active product ad in the same campaign and ad group", () => {
    const result = resolveSkuAttribution(
      { sku: null, asin: null, campaignId: "camp-1", adGroupId: "ag-1" },
      [activeAd],
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      source: "SINGLE_ACTIVE_PRODUCT_AD",
      sku: "SKU-1",
      asin: "ASIN-1",
    });
  });

  it("blocks attribution when multiple active SKUs share the ad group", () => {
    const result = resolveSkuAttribution(
      { sku: null, asin: null, campaignId: "camp-1", adGroupId: "ag-1" },
      [
        activeAd,
        { ...activeAd, adId: "ad-2", sku: "SKU-2", asin: "ASIN-2" },
      ],
    );

    expect(result).toMatchObject({
      status: "UNRESOLVED",
      source: "UNRESOLVED_MULTI_SKU",
      sku: null,
    });
    expect(result.candidates.map((candidate) => candidate.sku)).toEqual([
      "SKU-1",
      "SKU-2",
    ]);
  });

  it("ignores paused product ads", () => {
    const result = resolveSkuAttribution(
      { sku: null, asin: null, campaignId: "camp-1", adGroupId: "ag-1" },
      [
        activeAd,
        { ...activeAd, adId: "ad-paused", sku: "SKU-PAUSED", estado: "PAUSED" },
      ],
    );

    expect(result).toMatchObject({
      status: "RESOLVED",
      source: "SINGLE_ACTIVE_PRODUCT_AD",
      sku: "SKU-1",
    });
  });
});
