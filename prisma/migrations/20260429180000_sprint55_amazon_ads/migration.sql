-- Sprint 5.5 — Amazon Advertising (Sponsored Products).
-- Sync diario do report `spAdvertisedProduct` por ASIN/SKU/dia.
-- AdsCampanha/AdsGastoManual existentes seguem como fallback ate estabilizar.

CREATE TABLE "AmazonAdsCampanha" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "estado" TEXT,
    "tipoTargeting" TEXT,
    "budgetCentavos" INTEGER,
    "ultimaSync" TIMESTAMP(3) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonAdsCampanha_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonAdsMetricaDiaria" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT,
    "asin" TEXT,
    "sku" TEXT,
    "impressoes" INTEGER NOT NULL DEFAULT 0,
    "cliques" INTEGER NOT NULL DEFAULT 0,
    "gastoCentavos" INTEGER NOT NULL DEFAULT 0,
    "vendasCentavos" INTEGER NOT NULL DEFAULT 0,
    "unidades" INTEGER NOT NULL DEFAULT 0,
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "acos" DOUBLE PRECISION,
    "produtoId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonAdsMetricaDiaria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonAdsCampanha_campaignId_key" ON "AmazonAdsCampanha"("campaignId");
CREATE INDEX "AmazonAdsCampanha_profileId_idx" ON "AmazonAdsCampanha"("profileId");
CREATE INDEX "AmazonAdsCampanha_estado_idx" ON "AmazonAdsCampanha"("estado");

CREATE UNIQUE INDEX "AmazonAdsMetricaDiaria_data_campaignId_adGroupId_asin_sku_key"
    ON "AmazonAdsMetricaDiaria"("data", "campaignId", "adGroupId", "asin", "sku");
CREATE INDEX "AmazonAdsMetricaDiaria_sku_data_idx" ON "AmazonAdsMetricaDiaria"("sku", "data");
CREATE INDEX "AmazonAdsMetricaDiaria_asin_data_idx" ON "AmazonAdsMetricaDiaria"("asin", "data");
CREATE INDEX "AmazonAdsMetricaDiaria_data_idx" ON "AmazonAdsMetricaDiaria"("data");
CREATE INDEX "AmazonAdsMetricaDiaria_produtoId_idx" ON "AmazonAdsMetricaDiaria"("produtoId");

ALTER TABLE "AmazonAdsMetricaDiaria"
    ADD CONSTRAINT "AmazonAdsMetricaDiaria_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "AmazonAdsCampanha"("campaignId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AmazonAdsMetricaDiaria"
    ADD CONSTRAINT "AmazonAdsMetricaDiaria_produtoId_fkey"
    FOREIGN KEY ("produtoId") REFERENCES "Produto"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
