/**
 * Diagnóstico rápido: quantos produtos, quantos SKUs MFS-, quantas vendas
 * vinculadas, quantos com vendas zeradas etc. Roda local, não escreve nada.
 */
import { db } from "@/lib/db";

async function main() {
  const totalProdutos = await db.produto.count();
  const ativos = await db.produto.count({ where: { ativo: true } });
  const comAsin = await db.produto.count({ where: { asin: { not: null } } });
  const mfs = await db.produto.count({
    where: { sku: { startsWith: "MFS-" } },
  });
  const naoMfsAtivos = await db.produto.findMany({
    where: { ativo: true, NOT: { sku: { startsWith: "MFS-" } } },
    select: { id: true, sku: true, nome: true, asin: true, estoqueAtual: true, amazonEstoqueTotal: true },
    take: 20,
  });

  console.log("\n=== PRODUTOS ===");
  console.log(`  Total: ${totalProdutos}`);
  console.log(`  Ativos: ${ativos}`);
  console.log(`  Com ASIN: ${comAsin}`);
  console.log(`  SKU MFS-*: ${mfs}`);
  console.log(`  Ativos NAO-MFS (amostra 20):`);
  for (const p of naoMfsAtivos) {
    console.log(`    sku=${p.sku.padEnd(28)} asin=${(p.asin ?? "—").padEnd(12)} estoque=${p.estoqueAtual} fba=${p.amazonEstoqueTotal ?? "—"} nome="${p.nome.slice(0, 50)}"`);
  }

  // Vendas
  const totalVendas = await db.vendaAmazon.count();
  const vendas7d = await db.vendaAmazon.count({
    where: { dataVenda: { gte: new Date(Date.now() - 7 * 86400000) } },
  });
  const vendas30d = await db.vendaAmazon.count({
    where: { dataVenda: { gte: new Date(Date.now() - 30 * 86400000) } },
  });

  console.log("\n=== VENDAS (VendaAmazon) ===");
  console.log(`  Total registros: ${totalVendas}`);
  console.log(`  Últimos 7d: ${vendas7d}`);
  console.log(`  Últimos 30d: ${vendas30d}`);

  // Quantos produtos têm pelo menos 1 venda nos últimos 30d
  const skusComVendas = await db.vendaAmazon.groupBy({
    by: ["sku"],
    where: { dataVenda: { gte: new Date(Date.now() - 30 * 86400000) } },
    _sum: { quantidade: true, liquidoMarketplaceCentavos: true, precoUnitarioCentavos: true },
    _count: { _all: true },
  });
  console.log(`  SKUs com venda nos últimos 30d: ${skusComVendas.length}`);

  // Top 10 vendedores 30d
  const top = skusComVendas
    .sort((a, b) => (b._sum.quantidade ?? 0) - (a._sum.quantidade ?? 0))
    .slice(0, 10);
  console.log(`  Top 10 SKUs por unidades 30d:`);
  for (const r of top) {
    console.log(
      `    ${r.sku.padEnd(28)} qty=${(r._sum.quantidade ?? 0).toString().padStart(4)}  liquido=R$ ${((r._sum.liquidoMarketplaceCentavos ?? 0) / 100).toFixed(2)}`,
    );
  }

  // Vendas com precoUnitarioCentavos = 0 (suspeitas)
  const vendasZeradas = await db.vendaAmazon.count({
    where: {
      OR: [
        { precoUnitarioCentavos: 0 },
        { liquidoMarketplaceCentavos: null },
      ],
    },
  });
  console.log(`  Vendas com precoUnitario=0 OU liquidoMarketplace=null: ${vendasZeradas} de ${totalVendas}`);

  // Reembolsos
  const totalReembolsos = await db.amazonReembolso.count();
  const reembolsosVinculados = await db.amazonReembolso.count({
    where: { produtoId: { not: null } },
  });
  console.log("\n=== REEMBOLSOS ===");
  console.log(`  Total: ${totalReembolsos}`);
  console.log(`  Vinculados a Produto: ${reembolsosVinculados}`);

  // Buybox snapshots
  const buybox = await db.buyBoxSnapshot.count();
  const buyboxRecentes = await db.buyBoxSnapshot.count({
    where: { capturadoEm: { gte: new Date(Date.now() - 24 * 3600000) } },
  });
  console.log("\n=== BUYBOX ===");
  console.log(`  Total snapshots: ${buybox}`);
  console.log(`  Últimas 24h: ${buyboxRecentes}`);

  // Ads
  const adsCampanhas = await db.adsCampanha.count();
  const adsManual = await db.adsGastoManual.count();
  console.log("\n=== ADS ===");
  console.log(`  Campanhas (CSV): ${adsCampanhas}`);
  console.log(`  Gastos manuais: ${adsManual}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
