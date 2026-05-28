-- CreateTable
CREATE TABLE "WhatsAppEstoqueProdutoExcluido" (
    "produtoId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppEstoqueProdutoExcluido_pkey" PRIMARY KEY ("produtoId")
);

-- CreateTable
CREATE TABLE "WhatsAppEstoqueEnvio" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "partes" INTEGER NOT NULL DEFAULT 1,
    "totaisJson" TEXT,
    "mensagemPreview" TEXT,
    "erro" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppEstoqueEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppEstoqueProdutoExcluido_sku_idx" ON "WhatsAppEstoqueProdutoExcluido"("sku");

-- CreateIndex
CREATE INDEX "WhatsAppEstoqueEnvio_tipo_idx" ON "WhatsAppEstoqueEnvio"("tipo");

-- CreateIndex
CREATE INDEX "WhatsAppEstoqueEnvio_status_idx" ON "WhatsAppEstoqueEnvio"("status");

-- CreateIndex
CREATE INDEX "WhatsAppEstoqueEnvio_iniciadoEm_idx" ON "WhatsAppEstoqueEnvio"("iniciadoEm");

-- AddForeignKey
ALTER TABLE "WhatsAppEstoqueProdutoExcluido" ADD CONSTRAINT "WhatsAppEstoqueProdutoExcluido_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
