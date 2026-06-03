-- Amazon Ads OAuth multi-seller.
-- Mantem ConfiguracaoSistema como fallback legado, mas passa a permitir grants
-- Ads por AmazonAccount e chaves de metricas por empresa/profile.

-- AlterTable: AmazonAccount
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsRefreshTokenEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsAccessTokenEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsProfileId" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsEndpoint" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsConectadoEm" TIMESTAMP(3);
ALTER TABLE "AmazonAccount" ADD COLUMN IF NOT EXISTS "adsStatus" TEXT NOT NULL DEFAULT 'PENDENTE';

-- AlterTable: Ads daily metrics
ALTER TABLE "AmazonAdsMetricaDiaria" ADD COLUMN IF NOT EXISTS "profileId" TEXT;
ALTER TABLE "AmazonAdsMetricaDiaria" ADD COLUMN IF NOT EXISTS "campanhaId" TEXT;

-- Remove relation/uniques globais antigos.
ALTER TABLE "AmazonAdsMetricaDiaria" DROP CONSTRAINT IF EXISTS "AmazonAdsMetricaDiaria_campaignId_fkey";
DROP INDEX IF EXISTS "AmazonAdsCampanha_campaignId_key";
DROP INDEX IF EXISTS "AmazonAdsMetricaDiaria_data_campaignId_adGroupId_asin_sku_key";
DROP INDEX IF EXISTS "AmazonAdsMetricaHoraria_horaInicio_dataset_campaignId_adGroupId_adId_asin_sku_key";
DROP INDEX IF EXISTS "AmazonAdsMetricaHoraria_unique_key";

-- Backfill single-tenant atual. O profile vem da config Ads salva; fallback para
-- o profile BR observado em producao.
DO $$
DECLARE
  v_empresa TEXT := 'mundofs';
  v_profile TEXT;
  v_refresh TEXT;
  v_endpoint TEXT;
BEGIN
  SELECT NULLIF("valor", '') INTO v_profile
    FROM "ConfiguracaoSistema"
   WHERE "chave" = 'amazon_ads_profile_id';
  v_profile := COALESCE(v_profile, '4067117576775818');

  SELECT NULLIF("valor", '') INTO v_refresh
    FROM "ConfiguracaoSistema"
   WHERE "chave" = 'amazon_ads_refresh_token';

  SELECT NULLIF("valor", '') INTO v_endpoint
    FROM "ConfiguracaoSistema"
   WHERE "chave" = 'amazon_ads_endpoint';

  UPDATE "AmazonAdsCampanha"
     SET "empresaId" = COALESCE("empresaId", v_empresa),
         "profileId" = COALESCE(NULLIF("profileId", ''), v_profile);

  UPDATE "AmazonAdsMetricaDiaria"
     SET "empresaId" = COALESCE("empresaId", v_empresa),
         "profileId" = COALESCE(NULLIF("profileId", ''), v_profile);

  UPDATE "AmazonAdsMetricaHoraria"
     SET "empresaId" = COALESCE("empresaId", v_empresa),
         "profileId" = COALESCE(NULLIF("profileId", ''), v_profile);

  UPDATE "AmazonAdsMetricaDiaria" d
     SET "campanhaId" = c."id"
    FROM "AmazonAdsCampanha" c
   WHERE d."campanhaId" IS NULL
     AND d."campaignId" = c."campaignId"
     AND COALESCE(d."empresaId", v_empresa) = COALESCE(c."empresaId", v_empresa)
     AND COALESCE(d."profileId", v_profile) = c."profileId";

  IF v_refresh IS NOT NULL THEN
    UPDATE "AmazonAccount"
       SET "adsRefreshTokenEnc" = COALESCE("adsRefreshTokenEnc", v_refresh),
           "adsProfileId" = COALESCE("adsProfileId", v_profile),
           "adsEndpoint" = COALESCE("adsEndpoint", v_endpoint),
           "adsStatus" = 'ATIVA',
           "adsConectadoEm" = COALESCE("adsConectadoEm", CURRENT_TIMESTAMP),
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "empresaId" = v_empresa;

    INSERT INTO "AmazonAccount" (
      "id",
      "empresaId",
      "nome",
      "adsRefreshTokenEnc",
      "adsProfileId",
      "adsEndpoint",
      "adsStatus",
      "adsConectadoEm",
      "ativa",
      "status",
      "createdAt",
      "updatedAt"
    )
    SELECT
      'amazon-account-mundofs',
      v_empresa,
      'Conta Amazon',
      v_refresh,
      v_profile,
      v_endpoint,
      'ATIVA',
      CURRENT_TIMESTAMP,
      true,
      'PENDENTE',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    WHERE EXISTS (SELECT 1 FROM "Empresa" WHERE "id" = v_empresa)
      AND NOT EXISTS (SELECT 1 FROM "AmazonAccount" WHERE "empresaId" = v_empresa);
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AmazonAdsCampanha_empresa_profile_campaign_key"
  ON "AmazonAdsCampanha"("empresaId", "profileId", "campaignId");

CREATE UNIQUE INDEX IF NOT EXISTS "AmazonAdsDaily_empresa_profile_key"
  ON "AmazonAdsMetricaDiaria"("empresaId", "profileId", "data", "campaignId", "adGroupId", "asin", "sku");

CREATE INDEX IF NOT EXISTS "AmazonAdsDaily_profile_data_idx"
  ON "AmazonAdsMetricaDiaria"("profileId", "data");

CREATE INDEX IF NOT EXISTS "AmazonAdsDaily_campanha_idx"
  ON "AmazonAdsMetricaDiaria"("campanhaId");

CREATE UNIQUE INDEX IF NOT EXISTS "AmazonAdsHourly_empresa_profile_key"
  ON "AmazonAdsMetricaHoraria"("empresaId", "profileId", "horaInicio", "dataset", "campaignId", "adGroupId", "adId", "asin", "sku");

-- AddForeignKey
ALTER TABLE "AmazonAdsMetricaDiaria"
  ADD CONSTRAINT "AmazonAdsMetricaDiaria_campanhaId_fkey"
  FOREIGN KEY ("campanhaId") REFERENCES "AmazonAdsCampanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
