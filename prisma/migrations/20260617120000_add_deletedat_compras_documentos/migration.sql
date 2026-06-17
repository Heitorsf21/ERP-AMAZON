-- Onda 2/3 — soft-delete (auditoria) consistente em Compras e Documentos Financeiros.
-- Coluna nullable e aditiva: nenhuma linha existente é afetada (deletedAt = NULL).
ALTER TABLE "PedidoCompra" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ItemPedidoCompra" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "DocumentoFinanceiro" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "DossieFinanceiro" ADD COLUMN "deletedAt" TIMESTAMP(3);
