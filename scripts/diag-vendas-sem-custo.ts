import { db } from "@/lib/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  console.log("=== SKUs com vendas sem custo (apos importar custos historicos) ===");
  const rows = await db.$queryRawUnsafe<
    Array<{ sku: string; vendas: bigint; tem_produto: boolean }>
  >(`
    SELECT v.sku, COUNT(*)::bigint AS vendas,
           EXISTS(SELECT 1 FROM "Produto" p WHERE p.sku = v.sku) AS tem_produto
    FROM "VendaAmazon" v
    WHERE v."custoUnitarioCentavos" IS NULL OR v."custoUnitarioCentavos" <= 0
    GROUP BY v.sku
    ORDER BY vendas DESC
    LIMIT 30;
  `);
  console.table(
    rows.map((r) => ({
      sku: r.sku,
      vendas_sem_custo: Number(r.vendas),
      produto_existe: r.tem_produto,
    })),
  );

  await db.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
