-- Ads Optimizer: entidades editáveis, métricas granulares e fila de aprovação.

CREATE TABLE "AmazonAdsOptimizerState" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "chave" TEXT NOT NULL,
  "valor" TEXT,
  "payloadJson" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsOptimizerState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsAdGroup" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "adGroupId" TEXT NOT NULL,
  "nome" TEXT,
  "estado" TEXT,
  "defaultBidCentavos" INTEGER,
  "servingStatus" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsAdGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsProductAd" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "adGroupId" TEXT NOT NULL,
  "adId" TEXT NOT NULL,
  "sku" TEXT,
  "asin" TEXT,
  "estado" TEXT,
  "servingStatus" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsProductAd_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsKeyword" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "adGroupId" TEXT NOT NULL,
  "keywordId" TEXT NOT NULL,
  "keywordText" TEXT NOT NULL,
  "matchType" TEXT,
  "estado" TEXT,
  "bidCentavos" INTEGER,
  "servingStatus" TEXT,
  "campaignName" TEXT,
  "adGroupName" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsTarget" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "adGroupId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "expressionType" TEXT,
  "expressionText" TEXT NOT NULL,
  "targetType" TEXT,
  "estado" TEXT,
  "bidCentavos" INTEGER,
  "servingStatus" TEXT,
  "campaignName" TEXT,
  "adGroupName" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsNegativeKeyword" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "adGroupId" TEXT,
  "negativeKeywordId" TEXT NOT NULL,
  "keywordText" TEXT NOT NULL,
  "matchType" TEXT,
  "estado" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsNegativeKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsNegativeTarget" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "adGroupId" TEXT,
  "negativeTargetId" TEXT NOT NULL,
  "expressionType" TEXT,
  "expressionText" TEXT NOT NULL,
  "targetType" TEXT,
  "estado" TEXT,
  "ultimaSync" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsNegativeTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsTargetingMetricDaily" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "naturalKey" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "data" TIMESTAMP(3) NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignName" TEXT,
  "adGroupId" TEXT,
  "adGroupName" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "keywordId" TEXT,
  "targetId" TEXT,
  "keywordText" TEXT,
  "targetingText" TEXT,
  "matchType" TEXT,
  "sku" TEXT,
  "asin" TEXT,
  "impressoes" INTEGER NOT NULL DEFAULT 0,
  "cliques" INTEGER NOT NULL DEFAULT 0,
  "gastoCentavos" INTEGER NOT NULL DEFAULT 0,
  "vendasCentavos" INTEGER NOT NULL DEFAULT 0,
  "unidades" INTEGER NOT NULL DEFAULT 0,
  "pedidos" INTEGER NOT NULL DEFAULT 0,
  "acos" DOUBLE PRECISION,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsTargetingMetricDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsSearchTermMetricDaily" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "naturalKey" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "data" TIMESTAMP(3) NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignName" TEXT,
  "adGroupId" TEXT,
  "adGroupName" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "keywordId" TEXT,
  "targetId" TEXT,
  "searchTerm" TEXT NOT NULL,
  "keywordText" TEXT,
  "targetingText" TEXT,
  "matchType" TEXT,
  "sku" TEXT,
  "asin" TEXT,
  "impressoes" INTEGER NOT NULL DEFAULT 0,
  "cliques" INTEGER NOT NULL DEFAULT 0,
  "gastoCentavos" INTEGER NOT NULL DEFAULT 0,
  "vendasCentavos" INTEGER NOT NULL DEFAULT 0,
  "unidades" INTEGER NOT NULL DEFAULT 0,
  "pedidos" INTEGER NOT NULL DEFAULT 0,
  "acos" DOUBLE PRECISION,
  "payloadJson" TEXT NOT NULL,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AmazonAdsSearchTermMetricDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdsOptimizationRun" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "profileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "iniciadoPorId" TEXT,
  "iniciadoPorEmail" TEXT,
  "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizadoEm" TIMESTAMP(3),
  "totalEntidades" INTEGER NOT NULL DEFAULT 0,
  "totalRecomendacoes" INTEGER NOT NULL DEFAULT 0,
  "erro" TEXT,
  "payloadJson" TEXT,
  CONSTRAINT "AdsOptimizationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdsOptimizationRecommendation" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "runId" TEXT,
  "profileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignName" TEXT,
  "adGroupId" TEXT,
  "adGroupName" TEXT,
  "keywordId" TEXT,
  "targetId" TEXT,
  "searchTerm" TEXT,
  "sku" TEXT,
  "asin" TEXT,
  "actionType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "motivo" TEXT NOT NULL,
  "risco" TEXT,
  "confianca" INTEGER NOT NULL DEFAULT 0,
  "currentBidCentavos" INTEGER,
  "proposedBidCentavos" INTEGER,
  "beforeState" TEXT,
  "proposedState" TEXT,
  "metrics7dJson" TEXT NOT NULL,
  "metrics30dJson" TEXT NOT NULL,
  "metricsLifetimeJson" TEXT NOT NULL,
  "evidenceJson" TEXT NOT NULL,
  "amazonPayloadJson" TEXT,
  "aprovadoPorId" TEXT,
  "aprovadoPorEmail" TEXT,
  "aprovadoEm" TIMESTAMP(3),
  "rejeitadoPorId" TEXT,
  "rejeitadoPorEmail" TEXT,
  "rejeitadoEm" TIMESTAMP(3),
  "executadoEm" TIMESTAMP(3),
  "staleReason" TEXT,
  "errorMessage" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdsOptimizationRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdsOptimizationExecutionLog" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT,
  "recommendationId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestJson" TEXT,
  "responseJson" TEXT,
  "errorMessage" TEXT,
  "executadoPorId" TEXT,
  "executadoPorEmail" TEXT,
  "executadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdsOptimizationExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdsOptState_empresa_profile_tipo_chave_key" ON "AmazonAdsOptimizerState"("empresaId", "profileId", "tipo", "chave");
CREATE INDEX "AdsOptState_profile_tipo_idx" ON "AmazonAdsOptimizerState"("profileId", "tipo");

CREATE UNIQUE INDEX "AmazonAdsAdGroup_empresa_profile_adGroup_key" ON "AmazonAdsAdGroup"("empresaId", "profileId", "adGroupId");
CREATE INDEX "AmazonAdsAdGroup_profile_campaign_idx" ON "AmazonAdsAdGroup"("profileId", "campaignId");
CREATE INDEX "AmazonAdsAdGroup_estado_idx" ON "AmazonAdsAdGroup"("estado");

CREATE UNIQUE INDEX "AmazonAdsProductAd_empresa_profile_ad_key" ON "AmazonAdsProductAd"("empresaId", "profileId", "adId");
CREATE INDEX "AmazonAdsProductAd_profile_campaign_idx" ON "AmazonAdsProductAd"("profileId", "campaignId");
CREATE INDEX "AmazonAdsProductAd_sku_idx" ON "AmazonAdsProductAd"("sku");
CREATE INDEX "AmazonAdsProductAd_asin_idx" ON "AmazonAdsProductAd"("asin");

CREATE UNIQUE INDEX "AmazonAdsKeyword_empresa_profile_keyword_key" ON "AmazonAdsKeyword"("empresaId", "profileId", "keywordId");
CREATE INDEX "AmazonAdsKeyword_profile_campaign_idx" ON "AmazonAdsKeyword"("profileId", "campaignId");
CREATE INDEX "AmazonAdsKeyword_adGroup_idx" ON "AmazonAdsKeyword"("adGroupId");
CREATE INDEX "AmazonAdsKeyword_keywordText_idx" ON "AmazonAdsKeyword"("keywordText");
CREATE INDEX "AmazonAdsKeyword_estado_idx" ON "AmazonAdsKeyword"("estado");

CREATE UNIQUE INDEX "AmazonAdsTarget_empresa_profile_target_key" ON "AmazonAdsTarget"("empresaId", "profileId", "targetId");
CREATE INDEX "AmazonAdsTarget_profile_campaign_idx" ON "AmazonAdsTarget"("profileId", "campaignId");
CREATE INDEX "AmazonAdsTarget_adGroup_idx" ON "AmazonAdsTarget"("adGroupId");
CREATE INDEX "AmazonAdsTarget_expressionText_idx" ON "AmazonAdsTarget"("expressionText");
CREATE INDEX "AmazonAdsTarget_estado_idx" ON "AmazonAdsTarget"("estado");

CREATE UNIQUE INDEX "AmazonAdsNegKeyword_empresa_profile_key" ON "AmazonAdsNegativeKeyword"("empresaId", "profileId", "negativeKeywordId");
CREATE INDEX "AmazonAdsNegKeyword_profile_campaign_idx" ON "AmazonAdsNegativeKeyword"("profileId", "campaignId");
CREATE INDEX "AmazonAdsNegKeyword_adGroup_idx" ON "AmazonAdsNegativeKeyword"("adGroupId");
CREATE INDEX "AmazonAdsNegKeyword_keywordText_idx" ON "AmazonAdsNegativeKeyword"("keywordText");

CREATE UNIQUE INDEX "AmazonAdsNegTarget_empresa_profile_key" ON "AmazonAdsNegativeTarget"("empresaId", "profileId", "negativeTargetId");
CREATE INDEX "AmazonAdsNegTarget_profile_campaign_idx" ON "AmazonAdsNegativeTarget"("profileId", "campaignId");
CREATE INDEX "AmazonAdsNegTarget_adGroup_idx" ON "AmazonAdsNegativeTarget"("adGroupId");
CREATE INDEX "AmazonAdsNegTarget_expressionText_idx" ON "AmazonAdsNegativeTarget"("expressionText");

CREATE UNIQUE INDEX "AdsTargetingMetric_empresa_natural_key" ON "AmazonAdsTargetingMetricDaily"("empresaId", "naturalKey");
CREATE INDEX "AdsTargetingMetric_profile_data_idx" ON "AmazonAdsTargetingMetricDaily"("profileId", "data");
CREATE INDEX "AdsTargetingMetric_campaign_data_idx" ON "AmazonAdsTargetingMetricDaily"("campaignId", "data");
CREATE INDEX "AdsTargetingMetric_entity_idx" ON "AmazonAdsTargetingMetricDaily"("entityType", "entityId");
CREATE INDEX "AdsTargetingMetric_sku_data_idx" ON "AmazonAdsTargetingMetricDaily"("sku", "data");

CREATE UNIQUE INDEX "AdsSearchTermMetric_empresa_natural_key" ON "AmazonAdsSearchTermMetricDaily"("empresaId", "naturalKey");
CREATE INDEX "AdsSearchTermMetric_profile_data_idx" ON "AmazonAdsSearchTermMetricDaily"("profileId", "data");
CREATE INDEX "AdsSearchTermMetric_campaign_data_idx" ON "AmazonAdsSearchTermMetricDaily"("campaignId", "data");
CREATE INDEX "AdsSearchTermMetric_entity_idx" ON "AmazonAdsSearchTermMetricDaily"("entityType", "entityId");
CREATE INDEX "AdsSearchTermMetric_searchTerm_idx" ON "AmazonAdsSearchTermMetricDaily"("searchTerm");
CREATE INDEX "AdsSearchTermMetric_sku_data_idx" ON "AmazonAdsSearchTermMetricDaily"("sku", "data");

CREATE INDEX "AdsOptimizationRun_profile_idx" ON "AdsOptimizationRun"("profileId");
CREATE INDEX "AdsOptimizationRun_status_idx" ON "AdsOptimizationRun"("status");
CREATE INDEX "AdsOptimizationRun_iniciadoEm_idx" ON "AdsOptimizationRun"("iniciadoEm");

CREATE INDEX "AdsOptRec_profile_status_idx" ON "AdsOptimizationRecommendation"("profileId", "status");
CREATE INDEX "AdsOptRec_action_idx" ON "AdsOptimizationRecommendation"("actionType");
CREATE INDEX "AdsOptRec_severity_idx" ON "AdsOptimizationRecommendation"("severity");
CREATE INDEX "AdsOptRec_campaign_idx" ON "AdsOptimizationRecommendation"("campaignId");
CREATE INDEX "AdsOptRec_entity_idx" ON "AdsOptimizationRecommendation"("entityType", "entityId");
CREATE INDEX "AdsOptRec_criadoEm_idx" ON "AdsOptimizationRecommendation"("criadoEm");

CREATE INDEX "AdsOptExec_recommendation_idx" ON "AdsOptimizationExecutionLog"("recommendationId");
CREATE INDEX "AdsOptExec_status_idx" ON "AdsOptimizationExecutionLog"("status");
CREATE INDEX "AdsOptExec_executadoEm_idx" ON "AdsOptimizationExecutionLog"("executadoEm");

ALTER TABLE "AdsOptimizationRecommendation"
  ADD CONSTRAINT "AdsOptRec_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "AdsOptimizationRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdsOptimizationExecutionLog"
  ADD CONSTRAINT "AdsOptExec_recommendation_fkey"
  FOREIGN KEY ("recommendationId") REFERENCES "AdsOptimizationRecommendation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
