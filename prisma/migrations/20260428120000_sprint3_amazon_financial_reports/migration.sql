-- Sprint 3 — reports financeiros Amazon pendentes.
-- Adiciona FBA Reimbursements, Returns, Storage Fees e Sales & Traffic diário.

CREATE TABLE "AmazonReimbursement" (
    "id" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "reportId" TEXT,
    "reimbursementId" TEXT,
    "caseId" TEXT,
    "amazonOrderId" TEXT,
    "approvalDate" TIMESTAMP(3),
    "sku" TEXT,
    "fnSku" TEXT,
    "asin" TEXT,
    "productName" TEXT,
    "reason" TEXT,
    "condition" TEXT,
    "currency" TEXT,
    "amountPerUnitCentavos" INTEGER,
    "amountTotalCentavos" INTEGER NOT NULL DEFAULT 0,
    "quantityCash" INTEGER NOT NULL DEFAULT 0,
    "quantityInventory" INTEGER NOT NULL DEFAULT 0,
    "quantityTotal" INTEGER NOT NULL DEFAULT 0,
    "originalReimbursementId" TEXT,
    "originalReimbursementType" TEXT,
    "produtoId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonReimbursement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonReturn" (
    "id" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "reportId" TEXT,
    "tipoReport" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3),
    "amazonOrderId" TEXT,
    "sku" TEXT,
    "fnSku" TEXT,
    "asin" TEXT,
    "productName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "fulfillmentCenterId" TEXT,
    "detailedDisposition" TEXT,
    "reason" TEXT,
    "status" TEXT,
    "licensePlateNumber" TEXT,
    "customerComments" TEXT,
    "valorEstimadoCentavos" INTEGER,
    "produtoId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonStorageFee" (
    "id" TEXT NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "reportId" TEXT,
    "asin" TEXT,
    "fnSku" TEXT,
    "productName" TEXT,
    "fulfillmentCenter" TEXT,
    "countryCode" TEXT,
    "monthOfCharge" TIMESTAMP(3),
    "storageRate" DOUBLE PRECISION,
    "currency" TEXT,
    "averageQuantityOnHand" DOUBLE PRECISION,
    "averageQuantityPendingRemoval" DOUBLE PRECISION,
    "estimatedTotalItemVolume" DOUBLE PRECISION,
    "itemVolume" DOUBLE PRECISION,
    "volumeUnits" TEXT,
    "productSizeTier" TEXT,
    "storageFeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "dangerousGoodsStorageType" TEXT,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonStorageFee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmazonSkuTrafficDaily" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "parentAsin" TEXT,
    "childAsin" TEXT,
    "sessoes" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "unitsOrdered" INTEGER NOT NULL DEFAULT 0,
    "buyBoxPercent" DOUBLE PRECISION,
    "conversaoPercent" DOUBLE PRECISION,
    "orderedRevenueCentavos" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "produtoId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSkuTrafficDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonReimbursement_naturalKey_key" ON "AmazonReimbursement"("naturalKey");
CREATE INDEX "AmazonReimbursement_approvalDate_idx" ON "AmazonReimbursement"("approvalDate");
CREATE INDEX "AmazonReimbursement_sku_idx" ON "AmazonReimbursement"("sku");
CREATE INDEX "AmazonReimbursement_asin_idx" ON "AmazonReimbursement"("asin");
CREATE INDEX "AmazonReimbursement_reimbursementId_idx" ON "AmazonReimbursement"("reimbursementId");
CREATE INDEX "AmazonReimbursement_produtoId_idx" ON "AmazonReimbursement"("produtoId");

CREATE UNIQUE INDEX "AmazonReturn_naturalKey_key" ON "AmazonReturn"("naturalKey");
CREATE INDEX "AmazonReturn_returnDate_idx" ON "AmazonReturn"("returnDate");
CREATE INDEX "AmazonReturn_amazonOrderId_idx" ON "AmazonReturn"("amazonOrderId");
CREATE INDEX "AmazonReturn_sku_idx" ON "AmazonReturn"("sku");
CREATE INDEX "AmazonReturn_asin_idx" ON "AmazonReturn"("asin");
CREATE INDEX "AmazonReturn_produtoId_idx" ON "AmazonReturn"("produtoId");
CREATE INDEX "AmazonReturn_tipoReport_idx" ON "AmazonReturn"("tipoReport");

CREATE UNIQUE INDEX "AmazonStorageFee_naturalKey_key" ON "AmazonStorageFee"("naturalKey");
CREATE INDEX "AmazonStorageFee_monthOfCharge_idx" ON "AmazonStorageFee"("monthOfCharge");
CREATE INDEX "AmazonStorageFee_asin_idx" ON "AmazonStorageFee"("asin");
CREATE INDEX "AmazonStorageFee_fnSku_idx" ON "AmazonStorageFee"("fnSku");

CREATE UNIQUE INDEX "AmazonSkuTrafficDaily_sku_data_key" ON "AmazonSkuTrafficDaily"("sku", "data");
CREATE INDEX "AmazonSkuTrafficDaily_data_idx" ON "AmazonSkuTrafficDaily"("data");
CREATE INDEX "AmazonSkuTrafficDaily_sku_idx" ON "AmazonSkuTrafficDaily"("sku");
CREATE INDEX "AmazonSkuTrafficDaily_produtoId_idx" ON "AmazonSkuTrafficDaily"("produtoId");
CREATE INDEX "AmazonSkuTrafficDaily_childAsin_idx" ON "AmazonSkuTrafficDaily"("childAsin");

ALTER TABLE "AmazonReimbursement" ADD CONSTRAINT "AmazonReimbursement_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AmazonReturn" ADD CONSTRAINT "AmazonReturn_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AmazonSkuTrafficDaily" ADD CONSTRAINT "AmazonSkuTrafficDaily_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
