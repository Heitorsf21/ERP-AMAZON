-- Ads optimizer: tenant-scoped campaign and portfolio cache.

CREATE TABLE "AmazonAdsPortfolio" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "portfolioId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "estado" TEXT,
  "budgetCentavos" INTEGER,
  "budgetPolicy" TEXT,
  "currencyCode" TEXT,
  "inBudget" BOOLEAN,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AmazonAdsPortfolio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsCampaignEntity" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "portfolioId" TEXT,
  "nome" TEXT NOT NULL,
  "estado" TEXT,
  "targetingType" TEXT,
  "budgetCentavos" INTEGER,
  "budgetType" TEXT,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "servingStatus" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AmazonAdsCampaignEntity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AmazonAdsAdGroup" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsProductAd" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsKeyword" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsTarget" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsNegativeKeyword" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsNegativeTarget" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsTargetingMetricDaily" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AmazonAdsSearchTermMetricDaily" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AdsOptimizationRecommendation" ADD COLUMN "portfolioId" TEXT;
ALTER TABLE "AdsOptimizationRecommendation" ADD COLUMN "portfolioName" TEXT;

CREATE UNIQUE INDEX "AmazonAdsPortfolio_empresaId_profileId_portfolioId_key"
  ON "AmazonAdsPortfolio"("empresaId", "profileId", "portfolioId");
CREATE INDEX "AmazonAdsPortfolio_profileId_estado_idx"
  ON "AmazonAdsPortfolio"("profileId", "estado");
CREATE INDEX "AmazonAdsPortfolio_nome_idx"
  ON "AmazonAdsPortfolio"("nome");

CREATE UNIQUE INDEX "AmazonAdsCampaignEntity_empresaId_profileId_campaignId_key"
  ON "AmazonAdsCampaignEntity"("empresaId", "profileId", "campaignId");
CREATE INDEX "AmazonAdsCampaignEntity_profileId_portfolioId_idx"
  ON "AmazonAdsCampaignEntity"("profileId", "portfolioId");
CREATE INDEX "AmazonAdsCampaignEntity_profileId_estado_idx"
  ON "AmazonAdsCampaignEntity"("profileId", "estado");
CREATE INDEX "AmazonAdsCampaignEntity_nome_idx"
  ON "AmazonAdsCampaignEntity"("nome");
