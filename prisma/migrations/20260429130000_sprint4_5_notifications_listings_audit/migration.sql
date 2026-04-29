-- Sprint 4/5 - SQS notifications, audit log, product variations and FBM picking.

CREATE TABLE "AmazonNotification" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3),
    "publishTime" TIMESTAMP(3),
    "payloadJson" JSONB NOT NULL,
    "rawJson" JSONB NOT NULL,
    "processadoEm" TIMESTAMP(3),
    "jobsCriadosIds" JSONB,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "usuarioEmail" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "antesJson" JSONB,
    "depoisJson" JSONB,
    "metadataJson" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProdutoVariacao" (
    "id" TEXT NOT NULL,
    "produtoPaiId" TEXT NOT NULL,
    "produtoFilhoId" TEXT,
    "skuPai" TEXT NOT NULL,
    "skuFilho" TEXT,
    "nome" TEXT,
    "tipo" TEXT,
    "atributosJson" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoVariacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbmPickingBatch" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "etiquetaUrl" TEXT,
    "observacoes" TEXT,
    "criadoPorId" TEXT,
    "criadoPorEmail" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbmPickingBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FbmPickingItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "vendaAmazonId" TEXT,
    "amazonOrderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "titulo" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "checklistJson" JSONB,
    "separadoEm" TIMESTAMP(3),
    "conferidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbmPickingItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonNotification_notificationId_key" ON "AmazonNotification"("notificationId");
CREATE INDEX "AmazonNotification_notificationType_idx" ON "AmazonNotification"("notificationType");
CREATE INDEX "AmazonNotification_eventTime_idx" ON "AmazonNotification"("eventTime");
CREATE INDEX "AmazonNotification_publishTime_idx" ON "AmazonNotification"("publishTime");
CREATE INDEX "AmazonNotification_processadoEm_idx" ON "AmazonNotification"("processadoEm");
CREATE INDEX "AmazonNotification_criadoEm_idx" ON "AmazonNotification"("criadoEm");

CREATE INDEX "AuditLog_usuarioId_idx" ON "AuditLog"("usuarioId");
CREATE INDEX "AuditLog_usuarioEmail_idx" ON "AuditLog"("usuarioEmail");
CREATE INDEX "AuditLog_acao_idx" ON "AuditLog"("acao");
CREATE INDEX "AuditLog_entidade_entidadeId_idx" ON "AuditLog"("entidade", "entidadeId");
CREATE INDEX "AuditLog_criadoEm_idx" ON "AuditLog"("criadoEm");

CREATE UNIQUE INDEX "ProdutoVariacao_produtoFilhoId_key" ON "ProdutoVariacao"("produtoFilhoId");
CREATE UNIQUE INDEX "ProdutoVariacao_produtoPaiId_skuFilho_key" ON "ProdutoVariacao"("produtoPaiId", "skuFilho");
CREATE INDEX "ProdutoVariacao_produtoPaiId_idx" ON "ProdutoVariacao"("produtoPaiId");
CREATE INDEX "ProdutoVariacao_skuPai_idx" ON "ProdutoVariacao"("skuPai");
CREATE INDEX "ProdutoVariacao_skuFilho_idx" ON "ProdutoVariacao"("skuFilho");

CREATE UNIQUE INDEX "FbmPickingBatch_codigo_key" ON "FbmPickingBatch"("codigo");
CREATE INDEX "FbmPickingBatch_status_idx" ON "FbmPickingBatch"("status");
CREATE INDEX "FbmPickingBatch_criadoEm_idx" ON "FbmPickingBatch"("criadoEm");

CREATE UNIQUE INDEX "FbmPickingItem_batchId_amazonOrderId_sku_key" ON "FbmPickingItem"("batchId", "amazonOrderId", "sku");
CREATE INDEX "FbmPickingItem_batchId_idx" ON "FbmPickingItem"("batchId");
CREATE INDEX "FbmPickingItem_amazonOrderId_idx" ON "FbmPickingItem"("amazonOrderId");
CREATE INDEX "FbmPickingItem_sku_idx" ON "FbmPickingItem"("sku");
CREATE INDEX "FbmPickingItem_status_idx" ON "FbmPickingItem"("status");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProdutoVariacao" ADD CONSTRAINT "ProdutoVariacao_produtoPaiId_fkey"
  FOREIGN KEY ("produtoPaiId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProdutoVariacao" ADD CONSTRAINT "ProdutoVariacao_produtoFilhoId_fkey"
  FOREIGN KEY ("produtoFilhoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FbmPickingItem" ADD CONSTRAINT "FbmPickingItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "FbmPickingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProdutoMetricaGestorSeller" DROP COLUMN IF EXISTS "vendasMlCentavos";
ALTER TABLE "ProdutoMetricaGestorSeller" DROP COLUMN IF EXISTS "vendasShopeeCentavos";
ALTER TABLE "ProdutoMetricaGestorSeller" DROP COLUMN IF EXISTS "vendasTikTokCentavos";
