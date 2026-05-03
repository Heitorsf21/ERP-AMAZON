import { db } from "@/lib/db";

async function main() {
  const hoje = new Date("2026-05-01T03:00:00.000Z"); // meia-noite BRT
  const ontem = new Date("2026-04-30T03:00:00.000Z");

  const vendas = await db.vendaAmazon.findMany({
    where: { dataVenda: { gte: ontem } },
    orderBy: { dataVenda: "asc" },
    select: {
      amazonOrderId: true,
      sku: true,
      dataVenda: true,
      statusPedido: true,
      quantidade: true,
    },
  });

  console.log(`\nTotal (ontem + hoje): ${vendas.length}`);
  for (const v of vendas) {
    const isHoje = v.dataVenda >= hoje;
    console.log(`${isHoje ? "[HOJE] " : "[ONTEM]"} ${v.dataVenda.toISOString().slice(0, 16)} | ${v.sku.padEnd(12)} | ${v.statusPedido} | qty=${v.quantidade}`);
  }

  await db.$disconnect();
}

main().catch(console.error);
