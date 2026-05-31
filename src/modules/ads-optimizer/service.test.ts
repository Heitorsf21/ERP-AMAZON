import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const delegate = () => ({
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  });

  return {
    creds: {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      profileId: "profile-1",
    },
    db: {
      adsOptimizationRecommendation: delegate(),
      adsOptimizationExecutionLog: delegate(),
      amazonAdsPortfolio: delegate(),
      amazonAdsCampaignEntity: delegate(),
      amazonAdsKeyword: delegate(),
      amazonAdsTarget: delegate(),
      amazonAdsAdGroup: delegate(),
      amazonAdsProductAd: delegate(),
      amazonAdsNegativeKeyword: delegate(),
      amazonAdsNegativeTarget: delegate(),
      amazonAdsTargetingMetricDaily: delegate(),
      amazonAdsSearchTermMetricDaily: delegate(),
      amazonAdsOptimizerState: delegate(),
      adsOptimizationRun: delegate(),
    },
    api: {
      listSponsoredProductsAdGroups: vi.fn(),
      listSponsoredProductsCampaigns: vi.fn(),
      listAdsPortfolios: vi.fn(),
      listSponsoredProductsProductAds: vi.fn(),
      listSponsoredProductsKeywords: vi.fn(),
      listSponsoredProductsTargets: vi.fn(),
      listSponsoredProductsNegativeKeywords: vi.fn(),
      listSponsoredProductsNegativeTargets: vi.fn(),
      updateSponsoredProductsKeywords: vi.fn(),
      updateSponsoredProductsTargets: vi.fn(),
      createSponsoredProductsKeywords: vi.fn(),
      createSponsoredProductsNegativeKeywords: vi.fn(),
      createSponsoredProductsNegativeTargets: vi.fn(),
      createSpSearchTermReport: vi.fn(),
      createSpTargetingReport: vi.fn(),
      downloadAdsReportRows: vi.fn(),
      getAdsReport: vi.fn(),
    },
    getAmazonAdsCredentials: vi.fn(),
    isAmazonQuotaCooldownError: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/modules/amazon/ads-service", () => ({
  getAmazonAdsCredentials: mocks.getAmazonAdsCredentials,
}));
vi.mock("@/lib/amazon-ads-api", () => mocks.api);
vi.mock("@/lib/amazon-rate-limit", () => ({
  isAmazonQuotaCooldownError: mocks.isAmazonQuotaCooldownError,
}));

import { adsOptimizerService } from "./service";

const session = {
  uid: "user-1",
  email: "admin@atlas.test",
  role: "ADMIN",
} as never;

function approvedKeywordRecommendation() {
  return {
    id: "rec-1",
    profileId: "profile-1",
    status: "APPROVED",
    entityType: "KEYWORD",
    entityId: "kw-1",
    campaignId: "camp-1",
    adGroupId: "ag-1",
    keywordId: "kw-1",
    targetId: null,
    actionType: "DECREASE_BID",
    currentBidCentavos: 100,
    proposedBidCentavos: 95,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAmazonAdsCredentials.mockResolvedValue(mocks.creds);
  mocks.isAmazonQuotaCooldownError.mockReturnValue(false);

  mocks.api.listSponsoredProductsAdGroups.mockResolvedValue({ adGroups: [] });
  mocks.api.listSponsoredProductsCampaigns.mockResolvedValue({ campaigns: [] });
  mocks.api.listAdsPortfolios.mockResolvedValue({ portfolios: [] });
  mocks.api.listSponsoredProductsProductAds.mockResolvedValue({ productAds: [] });
  mocks.api.listSponsoredProductsKeywords.mockResolvedValue({ keywords: [] });
  mocks.api.listSponsoredProductsTargets.mockResolvedValue({ targets: [] });
  mocks.api.listSponsoredProductsNegativeKeywords.mockResolvedValue({
    negativeKeywords: [],
  });
  mocks.api.listSponsoredProductsNegativeTargets.mockResolvedValue({
    negativeTargets: [],
  });
  mocks.api.updateSponsoredProductsKeywords.mockResolvedValue({ ok: true });

  mocks.db.adsOptimizationRecommendation.findMany.mockResolvedValue([
    approvedKeywordRecommendation(),
  ]);
  mocks.db.adsOptimizationRecommendation.update.mockResolvedValue({});
  mocks.db.adsOptimizationExecutionLog.create.mockResolvedValue({});
  mocks.db.amazonAdsKeyword.findFirst.mockResolvedValue({
    keywordId: "kw-1",
    estado: "enabled",
    bidCentavos: 100,
  });
  mocks.db.amazonAdsTargetingMetricDaily.count.mockResolvedValue(0);
  mocks.db.amazonAdsSearchTermMetricDaily.count.mockResolvedValue(0);
});

describe("adsOptimizerService.runOptimization", () => {
  it("does not create a misleading zero-recommendation run while initial reports are pending", async () => {
    mocks.db.amazonAdsOptimizerState.findFirst.mockResolvedValue(null);
    mocks.db.amazonAdsOptimizerState.create.mockResolvedValue({});
    mocks.api.createSpTargetingReport.mockResolvedValue({ reportId: "target-report" });
    mocks.api.createSpSearchTermReport.mockResolvedValue({ reportId: "search-report" });

    const result = await adsOptimizerService.runOptimization(session);

    expect(mocks.db.adsOptimizationRun.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "PENDING_REPORTS",
      totalEntidades: 0,
      totalRecomendacoes: 0,
      metricCounts: { targeting: 0, searchTerms: 0 },
    });
  });

  it("returns cooldown status instead of creating a failed run", async () => {
    const error = {
      operation: "ADS_REPORTS_DOWNLOAD",
      nextAllowedAt: new Date("2026-05-31T23:27:40.000Z"),
    };
    mocks.api.getAdsReport.mockRejectedValue(error);
    mocks.isAmazonQuotaCooldownError.mockImplementation((value) => value === error);
    mocks.db.amazonAdsOptimizerState.findFirst.mockResolvedValue({
      valor: "pending-report-id",
    });

    const result = await adsOptimizerService.runOptimization(session);

    expect(mocks.db.adsOptimizationRun.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "COOLDOWN",
      operation: "ADS_REPORTS_DOWNLOAD",
      retryAt: "2026-05-31T23:27:40.000Z",
    });
  });
});

describe("adsOptimizerService.executeApproved", () => {
  it("executes an approved bid recommendation and logs the Amazon response", async () => {
    const result = await adsOptimizerService.executeApproved(session);

    expect(mocks.api.updateSponsoredProductsKeywords).toHaveBeenCalledWith(
      mocks.creds,
      [{ keywordId: "kw-1", bid: 0.95 }],
    );
    expect(mocks.db.adsOptimizationExecutionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recommendationId: "rec-1",
        status: "APPLIED",
        executadoPorId: "user-1",
      }),
    });
    expect(mocks.db.adsOptimizationRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: expect.objectContaining({ status: "APPLIED" }),
    });
    expect(result).toMatchObject({ total: 1, applied: 1, failed: 0, stale: 0 });
  });

  it("marks a recommendation as stale when the current bid changed", async () => {
    mocks.db.amazonAdsKeyword.findFirst.mockResolvedValue({
      keywordId: "kw-1",
      estado: "enabled",
      bidCentavos: 110,
    });

    const result = await adsOptimizerService.executeApproved(session);

    expect(mocks.api.updateSponsoredProductsKeywords).not.toHaveBeenCalled();
    expect(mocks.db.adsOptimizationExecutionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recommendationId: "rec-1",
        status: "STALE",
        errorMessage: "Bid atual mudou de 100 para 110",
      }),
    });
    expect(mocks.db.adsOptimizationRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: expect.objectContaining({ status: "STALE" }),
    });
    expect(result).toMatchObject({ total: 1, applied: 0, failed: 0, stale: 1 });
  });

  it("records failed Amazon writes without applying the recommendation", async () => {
    mocks.api.updateSponsoredProductsKeywords.mockRejectedValue(
      new Error("QuotaExceeded"),
    );

    const result = await adsOptimizerService.executeApproved(session);

    expect(mocks.db.adsOptimizationExecutionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recommendationId: "rec-1",
        status: "FAILED",
        errorMessage: "QuotaExceeded",
      }),
    });
    expect(mocks.db.adsOptimizationRecommendation.update).toHaveBeenCalledWith({
      where: { id: "rec-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "QuotaExceeded",
      }),
    });
    expect(result).toMatchObject({ total: 1, applied: 0, failed: 1, stale: 0 });
  });
});
