-- Adiciona campo de imposto Simples Nacional por venda Amazon.
-- Default 0; backfill populado via scripts/backfill-imposto-simples.ts.
ALTER TABLE "VendaAmazon"
  ADD COLUMN "impostoSimplesCentavos" INTEGER NOT NULL DEFAULT 0;
