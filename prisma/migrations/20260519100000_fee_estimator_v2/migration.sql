-- Fee Estimator v2:
-- 1. Produto.amazonCategoriaFee — slug de categoria opcional para o fee-estimator
--    aplicar tabela rica de comissão (tier + closing fee). Quando NULL, usa default
--    global 12%. Lista de slugs em listCommissionCategories().
-- 2. AmazonFeeEstimate.ruleVersion — string opcional para auditoria de qual versão
--    da regra de fees foi usada ("spapi-2025-08", "local-v2-2026-05", etc.).
ALTER TABLE "Produto" ADD COLUMN "amazonCategoriaFee" TEXT;
ALTER TABLE "AmazonFeeEstimate" ADD COLUMN "ruleVersion" TEXT;
