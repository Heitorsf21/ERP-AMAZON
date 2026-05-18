-- AmazonFeeEstimate: estimativa de taxas Amazon (comissão + FBA) por produto.
-- Atualizada por job AMAZON_FEE_ESTIMATE_SYNC (24h) via SP-API getMyFeesEstimateForSKU.
-- Usada apenas para vendas PENDENTE sem taxa real. Parcelamento NÃO estimado
-- (vem embutido em AmazonFees real como sub-breakdown AmazonForAllFee).
CREATE TABLE "AmazonFeeEstimate" (
    "produtoId" TEXT NOT NULL,
    "comissaoBps" INTEGER NOT NULL,
    "fbaCentavos" INTEGER NOT NULL,
    "ticketAvaliadoCentavos" INTEGER NOT NULL,
    "origem" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonFeeEstimate_pkey" PRIMARY KEY ("produtoId")
);

CREATE INDEX "AmazonFeeEstimate_atualizadoEm_idx" ON "AmazonFeeEstimate"("atualizadoEm");

ALTER TABLE "AmazonFeeEstimate" ADD CONSTRAINT "AmazonFeeEstimate_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
