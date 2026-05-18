/**
 * Diagnóstico de custos e taxas em VendaAmazon (read-only).
 */
import { db } from "@/lib/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  // Produtos
  const totalProdutos = await db.produto.count();
  const produtosComCusto = await db.produto.count({
    where: { custoUnitario: { gt: 0 } },
  });
  const produtosAtivos = await db.produto.count({ where: { ativo: true } });
  const produtosAtivosComCusto = await db.produto.count({
    where: { ativo: true, custoUnitario: { gt: 0 } },
  });
  console.log("=== Produtos ===");
  console.log(`  Total cadastrados:           ${totalProdutos}`);
  console.log(`  Com custoUnitario > 0:       ${produtosComCusto}`);
  console.log(`  Ativos:                      ${produtosAtivos}`);
  console.log(`  Ativos com custo:            ${produtosAtivosComCusto}`);

  // Vendas (total)
  const totalVendas = await db.vendaAmazon.count();
  const vendasComCusto = await db.vendaAmazon.count({
    where: { custoUnitarioCentavos: { gt: 0 } },
  });
  const vendasSemCusto = await db.vendaAmazon.count({
    where: {
      OR: [
        { custoUnitarioCentavos: null },
        { custoUnitarioCentavos: { lte: 0 } },
      ],
    },
  });
  const vendasComTaxa = await db.vendaAmazon.count({
    where: { taxasCentavos: { gt: 0 } },
  });
  const vendasTaxaZero = await db.vendaAmazon.count({
    where: { taxasCentavos: { lte: 0 } },
  });
  console.log("\n=== VendaAmazon (geral) ===");
  console.log(`  Total:                       ${totalVendas}`);
  console.log(`  Com custo > 0:               ${vendasComCusto}`);
  console.log(`  Sem custo (null ou 0):       ${vendasSemCusto}`);
  console.log(`  Com taxa > 0 (AmazonFees):   ${vendasComTaxa}`);
  console.log(`  Taxa zero:                   ${vendasTaxaZero}`);

  // Vendas por mês com taxa zero
  console.log("\n=== Vendas por mês — taxa zero vs preenchida ===");
  const rows = await db.$queryRawUnsafe<
    Array<{ mes: string; total: bigint; taxa_zero: bigint }>
  >(`
    SELECT
      to_char("dataVenda" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "taxasCentavos" <= 0)::bigint AS taxa_zero
    FROM "VendaAmazon"
    WHERE "dataVenda" >= NOW() - INTERVAL '12 months'
    GROUP BY mes
    ORDER BY mes DESC;
  `);
  console.table(
    rows.map((r) => ({
      mes: r.mes,
      total: Number(r.total),
      taxa_zero: Number(r.taxa_zero),
      pct_zero: `${((Number(r.taxa_zero) / Number(r.total)) * 100).toFixed(1)}%`,
    })),
  );

  // Backfill cursor
  console.log("\n=== Cursores de backfill ===");
  for (const chave of [
    "amazon_finances_backfill_cursor",
    "amazon_settlement_backfill_cursor",
    "amazon_orders_history_cursor",
    "amazon_loja_aberta_em",
  ]) {
    const c = await db.configuracaoSistema.findUnique({ where: { chave } });
    console.log(`  ${chave.padEnd(40)} = ${c?.valor ?? "(não definido)"}`);
  }

  // Top 10 produtos com mais vendas e sem custo cadastrado
  console.log("\n=== Top 10 SKUs com mais vendas e sem custo ===");
  const top = await db.$queryRawUnsafe<
    Array<{ sku: string; qtd: bigint; produto_tem_custo: boolean | null }>
  >(`
    SELECT v.sku, COUNT(*)::bigint AS qtd,
           CASE WHEN p."custoUnitario" > 0 THEN true ELSE false END AS produto_tem_custo
    FROM "VendaAmazon" v
    LEFT JOIN "Produto" p ON p.sku = v.sku
    WHERE v."custoUnitarioCentavos" IS NULL OR v."custoUnitarioCentavos" <= 0
    GROUP BY v.sku, p."custoUnitario"
    ORDER BY qtd DESC
    LIMIT 10;
  `);
  console.table(
    top.map((r) => ({
      sku: r.sku,
      vendas_sem_custo: Number(r.qtd),
      produto_tem_custo: r.produto_tem_custo,
    })),
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
