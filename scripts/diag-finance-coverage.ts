import { db } from "@/lib/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  // Para cada venda de jan/2026 sem taxa, EXISTE qualquer finance tx
  // referenciando esse amazonOrderId (em qualquer mês)?
  console.log("=== Vendas Jan/2026 com taxa=0: TEM finance TX (em qualquer mês)? ===");
  const r1 = await db.$queryRawUnsafe<Array<{ tem_tx: boolean; qtd: bigint }>>(`
    SELECT
      EXISTS(SELECT 1 FROM "AmazonFinanceTransaction" ft
             WHERE ft."amazonOrderId" = v."amazonOrderId") AS tem_tx,
      COUNT(*)::bigint AS qtd
    FROM "VendaAmazon" v
    WHERE v."dataVenda" >= '2026-01-01' AND v."dataVenda" < '2026-02-01'
      AND v."taxasCentavos" <= 0
    GROUP BY tem_tx;
  `);
  console.table(r1.map((r) => ({ tem_tx: r.tem_tx, qtd: Number(r.qtd) })));

  console.log("\n=== Mesma coisa para todos os meses: existe finance tx Shipment p/ a venda? ===");
  const r2 = await db.$queryRawUnsafe<Array<{ mes: string; total: bigint; com_tx: bigint }>>(`
    SELECT
      to_char(v."dataVenda" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE EXISTS(
          SELECT 1 FROM "AmazonFinanceTransaction" ft
          WHERE ft."amazonOrderId" = v."amazonOrderId"
            AND ft."transactionType" = 'Shipment'
        )
      )::bigint AS com_tx
    FROM "VendaAmazon" v
    WHERE v."dataVenda" >= NOW() - INTERVAL '10 months'
      AND v."taxasCentavos" <= 0
    GROUP BY mes
    ORDER BY mes DESC;
  `);
  console.table(
    r2.map((r) => ({
      mes: r.mes,
      sem_taxa: Number(r.total),
      tem_shipment_tx: Number(r.com_tx),
      pct: `${((Number(r.com_tx) / Number(r.total)) * 100).toFixed(1)}%`,
    })),
  );

  console.log("\n=== Amostra de finance TX Shipment p/ um pedido de jan/2026 ===");
  const oneOrder = await db.$queryRawUnsafe<Array<{ "amazonOrderId": string }>>(`
    SELECT v."amazonOrderId"
    FROM "VendaAmazon" v
    WHERE v."dataVenda" >= '2026-01-01' AND v."dataVenda" < '2026-02-01'
      AND v."taxasCentavos" <= 0
    LIMIT 1;
  `);
  if (oneOrder.length > 0 && oneOrder[0]) {
    const orderId = oneOrder[0].amazonOrderId;
    console.log(`Pedido: ${orderId}`);
    const fts = await db.amazonFinanceTransaction.findMany({
      where: { amazonOrderId: orderId },
      select: {
        transactionId: true,
        transactionType: true,
        transactionStatus: true,
        postedDate: true,
        sku: true,
        totalAmountCentavos: true,
      },
    });
    console.table(
      fts.map((t) => ({
        transactionId: t.transactionId.slice(0, 40),
        type: t.transactionType,
        status: t.transactionStatus,
        posted: t.postedDate?.toISOString().slice(0, 10),
        sku: t.sku,
        total: t.totalAmountCentavos ? `R$ ${(t.totalAmountCentavos / 100).toFixed(2)}` : "—",
      })),
    );

    // Verifica o payload de um Shipment para ver se tem breakdowns AmazonFees
    const shipment = fts.find((t) => t.transactionType === "Shipment");
    if (shipment) {
      console.log(`\n=== Payload de exemplo (Shipment) — primeiros 1500 chars ===`);
      const tx = await db.amazonFinanceTransaction.findUnique({
        where: { transactionId: shipment.transactionId },
        select: { payload: true },
      });
      const payload =
        typeof tx?.payload === "string"
          ? tx.payload
          : JSON.stringify(tx?.payload ?? null);
      console.log(payload.slice(0, 1500));
    }
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
