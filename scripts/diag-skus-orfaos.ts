import { db } from "@/lib/db";

const SKUS_ORFAOS = [
  "MFS-0022+", "MFS-0018+P", "MFS-0001", "MFS-0015", "MFS-0021+A",
  "MFS-0024", "MFS-0010", "MFS-0002", "MFS-0020+", "MFS-0018",
  "MFS-0005", "MFS-0011", "MFS-0009", "MFS-0004", "MFS-0003",
  "MFS-0008", "MFS-0019", "MFS-0020",
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  console.log("=== SKUs órfãos: têm vendas no banco? ===");
  const stats = await db.$queryRawUnsafe<
    Array<{ sku: string; vendas: bigint; ultima_venda: Date | null; com_custo: bigint }>
  >(`
    SELECT
      v.sku,
      COUNT(*)::bigint AS vendas,
      MAX(v."dataVenda") AS ultima_venda,
      COUNT(*) FILTER (WHERE v."custoUnitarioCentavos" > 0)::bigint AS com_custo
    FROM "VendaAmazon" v
    WHERE v.sku = ANY($1::text[])
    GROUP BY v.sku
    ORDER BY vendas DESC;
  `, SKUS_ORFAOS);
  console.table(
    stats.map((s) => ({
      sku: s.sku,
      vendas_no_banco: Number(s.vendas),
      com_custo: Number(s.com_custo),
      ultima_venda: s.ultima_venda?.toISOString().slice(0, 10) ?? "—",
    })),
  );

  console.log("\n=== SKUs já cadastrados como Produto (sample) ===");
  const cadastrados = await db.produto.findMany({
    select: { sku: true, nome: true, custoUnitario: true, ativo: true },
    orderBy: { sku: "asc" },
  });
  console.table(
    cadastrados.map((p) => ({
      sku: p.sku,
      nome: p.nome.slice(0, 50),
      custoUnit: p.custoUnitario ? `R$ ${(p.custoUnitario / 100).toFixed(2)}` : "—",
      ativo: p.ativo,
    })),
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
