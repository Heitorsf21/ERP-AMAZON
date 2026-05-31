import { describe, expect, it } from "vitest";
import {
  BID_STEP_CENTAVOS,
  deriveMetrics,
  emptyMetrics,
  evaluateAdsOptimizerRules,
  type AdsOptimizerMetrics,
  type AdsOptimizerRuleInput,
} from "./rules";

function metrics(
  override: Partial<Parameters<typeof deriveMetrics>[0]> = {},
): AdsOptimizerMetrics {
  return deriveMetrics({
    impressoes: 1000,
    cliques: 10,
    gastoCentavos: 1000,
    vendasCentavos: 5000,
    pedidos: 1,
    unidades: 1,
    ...override,
  });
}

function input(
  override: Partial<AdsOptimizerRuleInput> = {},
): AdsOptimizerRuleInput {
  return {
    entityType: "KEYWORD",
    entityId: "kw-1",
    label: "termo teste",
    campaignId: "camp-1",
    adGroupId: "ag-1",
    keywordId: "kw-1",
    targetId: null,
    searchTerm: null,
    matchType: "BROAD",
    estado: "enabled",
    currentBidCentavos: 100,
    metrics7d: emptyMetrics(),
    metricsPrev7d: emptyMetrics(),
    metrics30d: emptyMetrics(),
    metricsLifetime: emptyMetrics(),
    ...override,
  };
}

describe("evaluateAdsOptimizerRules", () => {
  it("pauses active keyword with 25 clicks and zero sales", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        metrics30d: metrics({
          cliques: 25,
          gastoCentavos: 2500,
          vendasCentavos: 0,
          pedidos: 0,
          unidades: 0,
        }),
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "PAUSE_KEYWORD",
      severity: "CRITICAL",
      ruleId: "TARGET_25_CLICKS_ZERO_SALES",
      proposedState: "paused",
    });
  });

  it("pauses target with high ACOS in two consecutive weeks", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        entityType: "TARGET",
        entityId: "target-1",
        keywordId: null,
        targetId: "target-1",
        metrics7d: metrics({ gastoCentavos: 6000, vendasCentavos: 10000 }),
        metricsPrev7d: metrics({ gastoCentavos: 5500, vendasCentavos: 10000 }),
        metrics30d: metrics({ gastoCentavos: 12000, vendasCentavos: 20000 }),
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "PAUSE_TARGET",
      severity: "HIGH",
      ruleId: "HIGH_ACOS_TWO_WEEKS",
    });
  });

  it("reduces bid when ACOS is above the healthy threshold", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        currentBidCentavos: 100,
        metrics30d: metrics({ gastoCentavos: 3200, vendasCentavos: 10000 }),
      }),
    );

    expect(result[0]).toMatchObject({
      actionType: "DECREASE_BID",
      proposedBidCentavos: 100 - BID_STEP_CENTAVOS,
    });
  });

  it("increases bid when 7d and 30d ACOS are low with consistent sales", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        currentBidCentavos: 100,
        metrics7d: metrics({ gastoCentavos: 700, vendasCentavos: 10000 }),
        metrics30d: metrics({
          gastoCentavos: 1400,
          vendasCentavos: 20000,
          pedidos: 2,
          unidades: 2,
        }),
      }),
    );

    expect(result[0]).toMatchObject({
      actionType: "INCREASE_BID",
      proposedBidCentavos: 100 + BID_STEP_CENTAVOS,
      ruleId: "ACOS_LOW_INCREASE_BID",
    });
  });

  it("does not increase bid when lifetime is good but the 7d window is weak", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        currentBidCentavos: 100,
        metrics7d: metrics({
          gastoCentavos: 1200,
          vendasCentavos: 10000,
          pedidos: 0,
          unidades: 0,
        }),
        metrics30d: metrics({
          gastoCentavos: 1400,
          vendasCentavos: 20000,
          pedidos: 2,
          unidades: 2,
        }),
        metricsLifetime: metrics({
          gastoCentavos: 3000,
          vendasCentavos: 50000,
          pedidos: 8,
          unidades: 8,
        }),
      }),
    );

    expect(result).toEqual([]);
  });

  it("does nothing with insufficient data", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        metrics30d: metrics({
          cliques: 12,
          gastoCentavos: 1200,
          vendasCentavos: 0,
          pedidos: 0,
          unidades: 0,
        }),
      }),
    );

    expect(result).toEqual([]);
  });

  it("suggests a negative target for ASIN search terms with 25 clicks and zero sales", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        entityType: "SEARCH_TERM",
        entityId: "SEARCH_TERM:camp-1:B0ABC12345",
        label: "B0ABC12345",
        keywordId: null,
        targetId: null,
        searchTerm: "B0ABC12345",
        metrics30d: metrics({
          cliques: 25,
          gastoCentavos: 2500,
          vendasCentavos: 0,
          pedidos: 0,
          unidades: 0,
        }),
      }),
    );

    expect(result[0]?.actionType).toBe("ADD_NEGATIVE_TARGET");
  });

  it("does not recommend actions for stale inactive entities", () => {
    const result = evaluateAdsOptimizerRules(
      input({
        estado: "paused",
        metrics30d: metrics({
          cliques: 40,
          gastoCentavos: 4000,
          vendasCentavos: 0,
          pedidos: 0,
          unidades: 0,
        }),
      }),
    );

    expect(result).toEqual([]);
  });
});
