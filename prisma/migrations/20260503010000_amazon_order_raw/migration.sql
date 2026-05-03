-- Cria tabela de pedidos brutos Amazon em nivel de pedido.
-- VendaAmazon continua sendo a tabela item/SKU comercial.

CREATE TABLE "AmazonOrderRaw" (
    "id" TEXT NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "statusPedido" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "createdTime" TIMESTAMP(3),
    "lastUpdatedTime" TIMESTAMP(3),
    "marketplaceId" TEXT,
    "fulfillmentChannel" TEXT,
    "payloadJson" JSONB NOT NULL,
    "itensProcessados" BOOLEAN NOT NULL DEFAULT false,
    "ultimaSyncEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonOrderRaw_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonOrderRaw_amazonOrderId_key" ON "AmazonOrderRaw"("amazonOrderId");
CREATE INDEX "AmazonOrderRaw_statusPedido_idx" ON "AmazonOrderRaw"("statusPedido");
CREATE INDEX "AmazonOrderRaw_createdTime_idx" ON "AmazonOrderRaw"("createdTime");
CREATE INDEX "AmazonOrderRaw_lastUpdatedTime_idx" ON "AmazonOrderRaw"("lastUpdatedTime");
CREATE INDEX "AmazonOrderRaw_itensProcessados_idx" ON "AmazonOrderRaw"("itensProcessados");
CREATE INDEX "AmazonOrderRaw_ultimaSyncEm_idx" ON "AmazonOrderRaw"("ultimaSyncEm");
