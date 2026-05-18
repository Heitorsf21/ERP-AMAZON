import { db } from "@/lib/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  // Conta quantas Shipment tx existem por (orderId, sku)
  const rows = await db.$queryRawUnsafe<
    Array<{ amazon_order_id: string; total_shipments: bigint; statuses: string }>
  >(`
    SELECT "amazonOrderId" AS amazon_order_id,
           COUNT(*)::bigint AS total_shipments,
           string_agg(DISTINCT "transactionStatus", ',') AS statuses
    FROM "AmazonFinanceTransaction"
    WHERE "transactionType" = 'Shipment'
    GROUP BY "amazonOrderId"
    ORDER BY total_shipments DESC
    LIMIT 5;
  `);
  console.log("Top 5 pedidos com mais Shipment tx:");
  console.table(rows.map((r) => ({ orderId: r.amazon_order_id, qtd: Number(r.total_shipments), statuses: r.statuses })));

  // Distribuição
  const dist = await db.$queryRawUnsafe<Array<{ qtd_shipments: bigint; pedidos: bigint }>>(`
    SELECT cnt AS qtd_shipments, COUNT(*)::bigint AS pedidos FROM (
      SELECT "amazonOrderId", COUNT(*) AS cnt
      FROM "AmazonFinanceTransaction"
      WHERE "transactionType" = 'Shipment'
      GROUP BY "amazonOrderId"
    ) x
    GROUP BY cnt
    ORDER BY cnt;
  `);
  console.log("\nDistribuição de Shipment tx por pedido:");
  console.table(dist.map((r) => ({ shipments_por_pedido: Number(r.qtd_shipments), pedidos: Number(r.pedidos) })));

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
