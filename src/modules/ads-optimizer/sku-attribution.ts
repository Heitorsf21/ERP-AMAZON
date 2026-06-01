export type SkuAttributionStatus = "RESOLVED" | "UNRESOLVED";

export type SkuAttributionSource =
  | "REPORT"
  | "SINGLE_ACTIVE_PRODUCT_AD"
  | "UNRESOLVED_MULTI_SKU"
  | "UNRESOLVED_NO_ACTIVE_PRODUCT_AD"
  | "UNRESOLVED_MISSING_AD_GROUP";

export type ProductAdForSkuAttribution = {
  campaignId: string;
  adGroupId: string;
  adId: string;
  sku: string | null;
  asin: string | null;
  estado: string | null;
};

export type SkuAttributionResult = {
  status: SkuAttributionStatus;
  source: SkuAttributionSource;
  sku: string | null;
  asin: string | null;
  candidates: Array<{ adId: string; sku: string; asin: string | null }>;
  blockedReason: string | null;
};

export function resolveSkuAttribution(
  input: {
    sku: string | null;
    asin: string | null;
    campaignId: string;
    adGroupId: string | null;
  },
  productAds: ProductAdForSkuAttribution[],
): SkuAttributionResult {
  if (input.sku) {
    return resolved("REPORT", input.sku, input.asin, []);
  }

  if (!input.adGroupId) {
    return unresolved(
      "UNRESOLVED_MISSING_AD_GROUP",
      "A Amazon nao informou ad group suficiente para atribuir este dado a um SKU com seguranca.",
      [],
    );
  }

  const activeCandidates = productAds
    .filter(
      (ad) =>
        ad.campaignId === input.campaignId &&
        ad.adGroupId === input.adGroupId &&
        isActiveState(ad.estado) &&
        !!ad.sku,
    )
    .map((ad) => ({
      adId: ad.adId,
      sku: ad.sku!,
      asin: ad.asin,
    }));

  const distinctCandidates = uniqueCandidates(activeCandidates);

  if (distinctCandidates.length === 1) {
    const candidate = distinctCandidates[0]!;
    return resolved(
      "SINGLE_ACTIVE_PRODUCT_AD",
      candidate.sku,
      candidate.asin,
      distinctCandidates,
    );
  }

  if (distinctCandidates.length > 1) {
    return unresolved(
      "UNRESOLVED_MULTI_SKU",
      "Este ad group possui mais de um SKU ativo. A Amazon nao atribui o termo pesquisado a um SKU especifico neste relatorio.",
      distinctCandidates,
    );
  }

  return unresolved(
    "UNRESOLVED_NO_ACTIVE_PRODUCT_AD",
    "Nao foi encontrado SKU ativo neste ad group para atribuir a recomendacao com seguranca.",
    [],
  );
}

function resolved(
  source: SkuAttributionSource,
  sku: string,
  asin: string | null,
  candidates: SkuAttributionResult["candidates"],
): SkuAttributionResult {
  return {
    status: "RESOLVED",
    source,
    sku,
    asin,
    candidates,
    blockedReason: null,
  };
}

function unresolved(
  source: SkuAttributionSource,
  blockedReason: string,
  candidates: SkuAttributionResult["candidates"],
): SkuAttributionResult {
  return {
    status: "UNRESOLVED",
    source,
    sku: null,
    asin: null,
    candidates,
    blockedReason,
  };
}

function isActiveState(value: string | null) {
  return value?.toLowerCase() === "enabled";
}

function uniqueCandidates(
  candidates: SkuAttributionResult["candidates"],
): SkuAttributionResult["candidates"] {
  const map = new Map<string, SkuAttributionResult["candidates"][number]>();
  for (const candidate of candidates) {
    map.set(`${candidate.sku}\u0000${candidate.asin ?? ""}`, candidate);
  }
  return [...map.values()];
}
