import { db } from "@/lib/db";

async function main() {
  const r = await db.produto.findMany({
    where: { ativo: true },
    select: {
      sku: true,
      amazonImagemUrl: true,
      asin: true,
      amazonCatalogSyncEm: true,
      amazonTituloOficial: true,
    },
    take: 12,
  });
  for (const p of r) {
    console.log(
      `${p.sku.padEnd(15)} asin=${(p.asin ?? "—").padEnd(12)} sync=${p.amazonCatalogSyncEm?.toISOString() ?? "(nunca)"} img=${p.amazonImagemUrl ? p.amazonImagemUrl.slice(0, 70) : "(NULL)"}`,
    );
  }
  const totalComImg = await db.produto.count({
    where: { ativo: true, amazonImagemUrl: { not: null } },
  });
  const totalAtivos = await db.produto.count({ where: { ativo: true } });
  console.log(`\n${totalComImg}/${totalAtivos} produtos ativos têm amazonImagemUrl preenchida.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
