-- Onda 1 — isolamento por empresa (parar corrupção ativa entre tenants).
-- Contexto: auditoria 2026-07-05 (docs/auditorias/2026-07-05-varredura-multitenant.json).
-- Zero perda de dados-fonte: só apagamos CACHES regeneráveis a partir da Amazon.

-- 1) TarefaRecorrente entra no escopo de tenant (TENANT_MODELS). Linhas legadas
--    nasceram sem empresaId (extensão não injetava): todas são da empresa
--    primária. Backfill antes de qualquer leitura escopada.
UPDATE "TarefaRecorrente" SET "empresaId" = 'mundofs' WHERE "empresaId" IS NULL;

-- 2) AmazonTrafficDaily por empresa. As linhas atuais estão CORROMPIDAS pelo
--    clobbering cross-tenant (job da UDN reescrevia os 30 dias da mundofs via
--    unique global em "data"). É cache de relatório (Sales & Traffic) —
--    regenerável por TRAFFIC_SYNC de cada empresa. Limpamos e trocamos o
--    unique global por composto [empresaId, data].
DELETE FROM "AmazonTrafficDaily";
DROP INDEX IF EXISTS "AmazonTrafficDaily_data_key";
CREATE UNIQUE INDEX "AmazonTrafficDaily_empresaId_data_key" ON "AmazonTrafficDaily"("empresaId", "data");
CREATE INDEX "AmazonTrafficDaily_data_idx" ON "AmazonTrafficDaily"("data");

-- 3) AmazonApiQuota por empresa (apps LWA independentes não podem dividir
--    cooldown). Linhas são estado efêmero de rate-limit (nextAllowedAt de
--    minutos) — recriadas na primeira chamada de cada operação.
DELETE FROM "AmazonApiQuota";
DROP INDEX IF EXISTS "AmazonApiQuota_operation_key";
CREATE UNIQUE INDEX "AmazonApiQuota_empresaId_operation_key" ON "AmazonApiQuota"("empresaId", "operation");
CREATE INDEX "AmazonApiQuota_operation_idx" ON "AmazonApiQuota"("operation");
