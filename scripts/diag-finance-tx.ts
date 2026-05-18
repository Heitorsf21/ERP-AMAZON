/**
 * Verifica se existem AmazonFinanceTransaction nos meses onde as vendas estão
 * com taxa=0. Se houver TX, significa que o backfill financeiro já trouxe os
 * dados — só faltou aplicar nas VendaAmazon.
 */
import { db } from "@/lib/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  console.log("=== AmazonFinanceTransaction por mês ===");
  const tx = await db.$queryRawUnsafe<
    Array<{ mes: string; total: bigint; refunds: bigint }>
  >(`
    SELECT
      to_char("postedDate" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "transactionType" ILIKE '%refund%')::bigint AS refunds
    FROM "AmazonFinanceTransaction"
    WHERE "postedDate" >= NOW() - INTERVAL '12 months'
    GROUP BY mes
    ORDER BY mes DESC;
  `);
  console.table(tx.map((r) => ({ mes: r.mes, total: Number(r.total), refunds: Number(r.refunds) })));

  console.log("\n=== Tipos de transactionType existentes ===");
  const types = await db.$queryRawUnsafe<
    Array<{ tipo: string | null; total: bigint }>
  >(`
    SELECT "transactionType" AS tipo, COUNT(*)::bigint AS total
    FROM "AmazonFinanceTransaction"
    GROUP BY "transactionType"
    ORDER BY total DESC;
  `);
  console.table(types.map((r) => ({ tipo: r.tipo, total: Number(r.total) })));

  console.log("\n=== Vendas Jan/2026 sem taxa: há finance tx equivalente? ===");
  const match = await db.$queryRawUnsafe<
    Array<{ tem_tx: boolean; qtd: bigint }>
  >(`
    SELECT
      EXISTS(
        SELECT 1 FROM "AmazonFinanceTransaction" ft
        WHERE ft."amazonOrderId" = v."amazonOrderId"
      ) AS tem_tx,
      COUNT(*)::bigint AS qtd
    FROM "VendaAmazon" v
    WHERE v."dataVenda" >= '2026-01-01' AND v."dataVenda" < '2026-02-01'
      AND v."taxasCentavos" <= 0
    GROUP BY tem_tx;
  `);
  console.table(match.map((r) => ({ tem_finance_tx: r.tem_tx, vendas_sem_taxa: Number(r.qtd) })));

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
