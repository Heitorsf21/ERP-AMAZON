-- Soft-delete: adiciona deletedAt (nullable) aos modelos financeiros críticos.
-- Registros marcados com deletedAt != NULL são tratados como deletados —
-- as queries de listagem e totais filtram deletedAt IS NULL.

ALTER TABLE "Movimentacao" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ContaPagar"   ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ContaReceber" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Índice composto para queries da DRE (filtra por período + status financeiro).
CREATE INDEX "VendaAmazon_dataVenda_statusFinanceiro_idx"
    ON "VendaAmazon"("dataVenda", "statusFinanceiro");
