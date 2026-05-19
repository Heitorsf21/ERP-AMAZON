import { describe, expect, it } from "vitest";
import {
  inferAmazonCategoriaFee,
  __test_utils__,
} from "@/modules/produtos/amazon-fee-category-mapper";
import type { SPCatalogItem } from "@/lib/amazon-sp-api";

function catalogItem(partial: Partial<SPCatalogItem>): SPCatalogItem {
  return { asin: "B000TESTE", ...partial };
}

describe("amazon-fee-category-mapper", () => {
  it("mapeia classification exata com acentos normalizados", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            marketplaceId: "A2Q3Y263D00KWC",
            classifications: [{ displayName: "Cozinha" }],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("cozinha");
    expect(result?.label).toBe("Cozinha");
    expect(result?.source).toBe("classification");
  });

  it("prioriza folha da classification antes do parent", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              {
                displayName: "Panelas",
                parent: { displayName: "Casa" },
              },
            ],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("cozinha");
    expect(result?.matchedText).toBe("Panelas");
  });

  it("usa productType como fallback quando nao ha classification", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        summaries: [{ productType: "LUXURY_BEAUTY" }],
      }),
    );

    expect(result?.slug).toBe("beleza-luxo");
  });

  it("nao escolhe categoria quando o texto e ambiguo", () => {
    expect(__test_utils__.resolveTextSlug("Casa e Cozinha", "classification")).toBeNull();
  });

  it("nao escolhe categoria quando classifications de mesmo nivel conflitam", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              { displayName: "Casa" },
              { displayName: "Cozinha" },
            ],
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("retorna null quando Amazon devolve categoria desconhecida", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [{ classifications: [{ displayName: "Categoria Alienigena" }] }],
      }),
    );

    expect(result).toBeNull();
  });
});
