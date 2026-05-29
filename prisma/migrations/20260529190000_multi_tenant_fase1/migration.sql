-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "Fornecedor" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "Movimentacao" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ContaPagar" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ContaFixa" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "DossieFinanceiro" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "DocumentoFinanceiro" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ContaReceber" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonFeeEstimate" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ProdutoCustoHistorico" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "VendaAmazon" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "VendaCustoEventual" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonOrderRaw" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ProdutoVariacao" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonReembolso" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AdsGastoManual" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "PedidoCompra" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ItemPedidoCompra" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonSyncLog" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonSyncJob" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonNotification" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonApiQuota" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonReviewSolicitation" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppEstoqueProdutoExcluido" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppEstoqueEnvio" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "LoteImportacaoFBA" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "VendaFBA" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "LoteMetricaGS" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ProdutoMetricaGestorSeller" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "ImportacaoLote" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AdsCampanha" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "Notificacao" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "Tarefa" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "FbmPickingBatch" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "FbmPickingItem" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonSettlementReport" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "BuyBoxSnapshot" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonFinanceTransaction" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "InventorySnapshot" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonReimbursement" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonReturn" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonStorageFee" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonSkuTrafficDaily" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonAdsCampanha" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonAdsMetricaDiaria" ADD COLUMN     "empresaId" TEXT;

-- AlterTable
ALTER TABLE "AmazonAdsMetricaHoraria" ADD COLUMN     "empresaId" TEXT;

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonAccount" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "marketplaceId" TEXT,
    "sellerId" TEXT,
    "endpoint" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlataformaUsuario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoAcesso" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlataformaUsuario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_slug_key" ON "Empresa"("slug");

-- CreateIndex
CREATE INDEX "Empresa_ativa_idx" ON "Empresa"("ativa");

-- CreateIndex
CREATE INDEX "AmazonAccount_empresaId_idx" ON "AmazonAccount"("empresaId");

-- CreateIndex
CREATE INDEX "AmazonAccount_ativa_idx" ON "AmazonAccount"("ativa");

-- CreateIndex
CREATE UNIQUE INDEX "PlataformaUsuario_email_key" ON "PlataformaUsuario"("email");

-- CreateIndex
CREATE INDEX "PlataformaUsuario_ativo_idx" ON "PlataformaUsuario"("ativo");

-- CreateIndex
CREATE INDEX "Usuario_empresaId_idx" ON "Usuario"("empresaId");

-- AddForeignKey
ALTER TABLE "AmazonAccount" ADD CONSTRAINT "AmazonAccount_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

