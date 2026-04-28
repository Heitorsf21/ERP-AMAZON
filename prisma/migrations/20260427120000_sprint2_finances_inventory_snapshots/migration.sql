-- Sprint 2 — backfill que sustenta a DRE
-- Adiciona AmazonFinanceTransaction (tabela bruta de transações financeiras) e
-- InventorySnapshot (snapshot diário de inventário FBA por SKU).

-- CreateTable
CREATE TABLE "AmazonFinanceTransaction" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "transactionType" TEXT,
    "transactionStatus" TEXT,
    "description" TEXT,
    "postedDate" TIMESTAMP(3),
    "marketplaceId" TEXT,
    "amazonOrderId" TEXT,
    "sku" TEXT,
    "totalAmountCentavos" INTEGER,
    "totalAmountCurrency" TEXT,
    "payload" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonFinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySnapshot" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "fnSku" TEXT,
    "fulfillableQuantity" INTEGER NOT NULL DEFAULT 0,
    "inboundWorkingQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "dataSnapshot" TIMESTAMP(3) NOT NULL,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmazonFinanceTransaction_transactionId_key" ON "AmazonFinanceTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "AmazonFinanceTransaction_postedDate_idx" ON "AmazonFinanceTransaction"("postedDate");

-- CreateIndex
CREATE INDEX "AmazonFinanceTransaction_transactionType_idx" ON "AmazonFinanceTransaction"("transactionType");

-- CreateIndex
CREATE INDEX "AmazonFinanceTransaction_amazonOrderId_idx" ON "AmazonFinanceTransaction"("amazonOrderId");

-- CreateIndex
CREATE INDEX "AmazonFinanceTransaction_sku_idx" ON "AmazonFinanceTransaction"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySnapshot_sku_dataSnapshot_key" ON "InventorySnapshot"("sku", "dataSnapshot");

-- CreateIndex
CREATE INDEX "InventorySnapshot_sku_idx" ON "InventorySnapshot"("sku");

-- CreateIndex
CREATE INDEX "InventorySnapshot_dataSnapshot_idx" ON "InventorySnapshot"("dataSnapshot");

-- CreateIndex
CREATE INDEX "InventorySnapshot_produtoId_idx" ON "InventorySnapshot"("produtoId");

-- AddForeignKey
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
