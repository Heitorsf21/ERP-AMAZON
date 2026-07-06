-- Onda 2 — uniques de negócio compostos com empresaId (Fase 1c do db.ts).
-- Sem perda: apenas backfill de empresaId NULL (linhas legadas = empresa
-- primária) e troca de índices. A criação dos uniques compostos NÃO pode
-- falhar por duplicata: o unique antigo (sem empresaId) era MAIS restritivo.

-- Backfill: linhas criadas antes do multi-tenant nasceram com empresaId NULL.
-- As da UDN (pós-onboarding) já nascem com empresaId via extensão.
UPDATE "InventorySnapshot"      SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;
UPDATE "AmazonSkuTrafficDaily"  SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;
UPDATE "AmazonStorageFee"       SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;
UPDATE "AmazonReimbursement"    SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;
UPDATE "AmazonReturn"           SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;
UPDATE "AmazonSettlementReport" SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;

-- InventorySnapshot: upsert do INVENTORY_SYNC (2min) não pode casar linha de
-- outro tenant quando o MESMO sku existir nas duas empresas.
DROP INDEX IF EXISTS "InventorySnapshot_sku_dataSnapshot_key";
CREATE UNIQUE INDEX "InventorySnapshot_empresaId_sku_dataSnapshot_key" ON "InventorySnapshot"("empresaId", "sku", "dataSnapshot");

-- AmazonSkuTrafficDaily: mesmo padrão (tráfego por SKU/dia).
DROP INDEX IF EXISTS "AmazonSkuTrafficDaily_sku_data_key";
CREATE UNIQUE INDEX "AmazonSkuTrafficDaily_empresaId_sku_data_key" ON "AmazonSkuTrafficDaily"("empresaId", "sku", "data");

-- naturalKey por empresa (as chaves naturais são derivadas de ASIN/report —
-- dois sellers podem vender o MESMO ASIN).
DROP INDEX IF EXISTS "AmazonStorageFee_naturalKey_key";
CREATE UNIQUE INDEX "AmazonStorageFee_empresaId_naturalKey_key" ON "AmazonStorageFee"("empresaId", "naturalKey");
CREATE INDEX "AmazonStorageFee_naturalKey_idx" ON "AmazonStorageFee"("naturalKey");

DROP INDEX IF EXISTS "AmazonReimbursement_naturalKey_key";
CREATE UNIQUE INDEX "AmazonReimbursement_empresaId_naturalKey_key" ON "AmazonReimbursement"("empresaId", "naturalKey");
CREATE INDEX "AmazonReimbursement_naturalKey_idx" ON "AmazonReimbursement"("naturalKey");

DROP INDEX IF EXISTS "AmazonReturn_naturalKey_key";
CREATE UNIQUE INDEX "AmazonReturn_empresaId_naturalKey_key" ON "AmazonReturn"("empresaId", "naturalKey");
CREATE INDEX "AmazonReturn_naturalKey_idx" ON "AmazonReturn"("naturalKey");

-- AmazonSettlementReport: reportId/settlementId são únicos POR CONTA Amazon,
-- não globalmente entre contas.
DROP INDEX IF EXISTS "AmazonSettlementReport_reportId_key";
DROP INDEX IF EXISTS "AmazonSettlementReport_settlementId_key";
CREATE UNIQUE INDEX "AmazonSettlementReport_empresaId_reportId_key" ON "AmazonSettlementReport"("empresaId", "reportId");
CREATE UNIQUE INDEX "AmazonSettlementReport_empresaId_settlementId_key" ON "AmazonSettlementReport"("empresaId", "settlementId");
CREATE INDEX "AmazonSettlementReport_reportId_idx" ON "AmazonSettlementReport"("reportId");
