-- Marketing Stream hourly metrics — push-based intraday data delivered via SQS.
-- Datasets: sp-traffic, sp-conversion, sd-traffic, sd-conversion, sb-traffic, sb-conversion.
-- Reconciliada com AmazonAdsMetricaDiaria: hourly e purgada quando daily report cobre o dia.

CREATE TABLE "AmazonAdsMetricaHoraria" (
    "id" TEXT NOT NULL,
    "horaInicio" TIMESTAMP(3) NOT NULL,
    "dataset" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT,
    "adId" TEXT,
    "asin" TEXT,
    "sku" TEXT,
    "impressoes" INTEGER NOT NULL DEFAULT 0,
    "cliques" INTEGER NOT NULL DEFAULT 0,
    "gastoCentavos" INTEGER NOT NULL DEFAULT 0,
    "vendasCentavos" INTEGER NOT NULL DEFAULT 0,
    "unidades" INTEGER NOT NULL DEFAULT 0,
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "produtoId" TEXT,
    "marketplaceId" TEXT,
    "currencyCode" TEXT,
    "eventoTimeMin" TIMESTAMP(3) NOT NULL,
    "eventoTimeMax" TIMESTAMP(3) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonAdsMetricaHoraria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonAdsMetricaHoraria_unique_key"
    ON "AmazonAdsMetricaHoraria"("horaInicio", "dataset", "campaignId", "adGroupId", "adId", "asin", "sku");
CREATE INDEX "AmazonAdsMetricaHoraria_horaInicio_idx" ON "AmazonAdsMetricaHoraria"("horaInicio");
CREATE INDEX "AmazonAdsMetricaHoraria_profileId_horaInicio_idx" ON "AmazonAdsMetricaHoraria"("profileId", "horaInicio");
CREATE INDEX "AmazonAdsMetricaHoraria_sku_horaInicio_idx" ON "AmazonAdsMetricaHoraria"("sku", "horaInicio");
CREATE INDEX "AmazonAdsMetricaHoraria_dataset_horaInicio_idx" ON "AmazonAdsMetricaHoraria"("dataset", "horaInicio");
CREATE INDEX "AmazonAdsMetricaHoraria_campaignId_horaInicio_idx" ON "AmazonAdsMetricaHoraria"("campaignId", "horaInicio");
CREATE INDEX "AmazonAdsMetricaHoraria_produtoId_idx" ON "AmazonAdsMetricaHoraria"("produtoId");

ALTER TABLE "AmazonAdsMetricaHoraria"
    ADD CONSTRAINT "AmazonAdsMetricaHoraria_produtoId_fkey"
    FOREIGN KEY ("produtoId") REFERENCES "Produto"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
