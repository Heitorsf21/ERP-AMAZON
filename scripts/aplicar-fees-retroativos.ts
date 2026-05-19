/**
 * Aplica taxas/fretes Amazon Fees em VendaAmazon usando AmazonFinanceTransaction
 * já presentes no banco — sem chamar SP-API. Cobre o gap do FINANCES_SYNC
 * que só processa últimos 14 dias.
 *
 * Modo:
 *   --dry-run (default): só mostra o que seria atualizado.
 *   --apply            : aplica as mudanças.
 *
 * Lógica (espelha syncFinancialEvents em service.ts):
 *   1. Busca todas VendaAmazon com taxasCentavos <= 0.
 *   2. Para cada amazonOrderId, busca AmazonFinanceTransaction tipo 'Shipment'.
 *   3. Parseia payload, encontra o item com SKU correspondente.
 *   4. Extrai breakdownAmount "AmazonFees" e "Shipping*".
 *   5. Atualiza taxasCentavos / fretesCentavos / liquidoMarketplaceCentavos.
 */
import { db } from "@/lib/db";

type Args = {
  apply: boolean;
  reaplicar: boolean;
  sinceMonth?: string; // YYYY-MM
  limit?: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const reaplicar = argv.includes("--reaplicar");
  const since = argv[argv.indexOf("--since") + 1];
  const limit = argv[argv.indexOf("--limit") + 1];
  return {
    apply,
    reaplicar,
    sinceMonth: since && /^\d{4}-\d{2}$/.test(since) ? since : undefined,
    limit: limit ? Number(limit) : undefined,
  };
}

function preferenciaStatus(status: string | null | undefined): number {
  const s = (status ?? "").toUpperCase();
  if (s === "RELEASED") return 4;
  if (s === "DEFERRED_RELEASED") return 3;
  if (s === "DEFERRED") return 2;
  return 1;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");
  const args = parseArgs();

  console.log(
    `Modo: ${args.apply ? "APPLY" : "DRY-RUN"}${args.reaplicar ? " | REAPLICAR (inclui taxas>0)" : ""}${args.sinceMonth ? ` | desde ${args.sinceMonth}` : ""}${args.limit ? ` | limit ${args.limit}` : ""}`,
  );

  const filtroData = args.sinceMonth
    ? { dataVenda: { gte: new Date(`${args.sinceMonth}-01T00:00:00-03:00`) } }
    : {};

  const vendas = await db.vendaAmazon.findMany({
    where: {
      ...(args.reaplicar ? {} : { taxasCentavos: { lte: 0 } }),
      ...filtroData,
    },
    select: {
      id: true,
      amazonOrderId: true,
      sku: true,
      quantidade: true,
      valorBrutoCentavos: true,
      precoUnitarioCentavos: true,
      taxasCentavos: true,
      fretesCentavos: true,
      liquidoMarketplaceCentavos: true,
      statusFinanceiro: true,
    },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(`\n${vendas.length} vendas para processar.`);

  if (vendas.length === 0) return;

  // Pré-carrega TODAS as finance tx Shipment desses orderIds
  const orderIds = [...new Set(vendas.map((v) => v.amazonOrderId))];
  console.log(`Buscando AmazonFinanceTransaction para ${orderIds.length} pedidos únicos...`);

  const txs = await db.amazonFinanceTransaction.findMany({
    where: {
      amazonOrderId: { in: orderIds },
      transactionType: { in: ["Shipment", "Refund"] },
    },
    select: {
      amazonOrderId: true,
      transactionType: true,
      transactionStatus: true,
      payload: true,
    },
  });
  console.log(`${txs.length} transações financeiras carregadas.`);

  const txsPorOrder = new Map<string, typeof txs>();
  for (const tx of txs) {
    if (!tx.amazonOrderId) continue;
    const arr = txsPorOrder.get(tx.amazonOrderId) ?? [];
    arr.push(tx);
    txsPorOrder.set(tx.amazonOrderId, arr);
  }

  let atualizadas = 0;
  let semFinanceTx = 0;
  let semItemMatch = 0;
  let semAmazonFees = 0;
  const exemplos: Array<{
    orderId: string;
    sku: string;
    bruto: number;
    taxas: number;
    fretes: number;
    liquido: number;
    statusFinanceiro: string;
  }> = [];

  for (const v of vendas) {
    const transacoes = txsPorOrder.get(v.amazonOrderId) ?? [];
    if (transacoes.length === 0) {
      semFinanceTx++;
      continue;
    }

    // Considera SÓ Shipment (refund é tratado em outro lugar)
    const shipments = transacoes.filter((t) => t.transactionType === "Shipment");
    if (shipments.length === 0) {
      semFinanceTx++;
      continue;
    }

    // Ordena Shipment tx por preferência (RELEASED > DEFERRED_RELEASED > DEFERRED)
    // e usa APENAS a mais "final" para evitar dobrar valores. Múltiplas Shipment
    // tx por pedido são normais (estados intermediários antes da liquidação final).
    const ordenadas = [...shipments].sort(
      (a, b) =>
        preferenciaStatus(b.transactionStatus) -
        preferenciaStatus(a.transactionStatus),
    );

    let escolhido:
      | { result: NonNullable<ReturnType<typeof extrairValoresDoPayload>>; status: string | null }
      | null = null;
    for (const tx of ordenadas) {
      const result = extrairValoresDoPayload(tx.payload, v.sku);
      if (result) {
        escolhido = { result, status: tx.transactionStatus ?? null };
        break;
      }
    }

    if (!escolhido) {
      semItemMatch++;
      continue;
    }

    if (escolhido.result.amazonFees === 0) {
      semAmazonFees++;
      continue;
    }

    if (exemplos.length < 5) {
      exemplos.push({
        orderId: v.amazonOrderId,
        sku: v.sku,
        bruto: escolhido.result.productCharges,
        taxas: escolhido.result.amazonFees,
        fretes: escolhido.result.shipping,
        liquido: escolhido.result.totalAmount,
        statusFinanceiro: escolhido.status ?? "—",
      });
    }

    if (args.apply) {
      await db.vendaAmazon.update({
        where: { id: v.id },
        data: {
          taxasCentavos: escolhido.result.amazonFees,
          fretesCentavos: escolhido.result.shipping,
          liquidoMarketplaceCentavos: escolhido.result.totalAmount,
          statusFinanceiro: escolhido.status ?? v.statusFinanceiro,
          ultimaSyncEm: new Date(),
        },
      });
    }
    atualizadas++;
  }

  console.log(`\n=== Resultado ===`);
  console.log(`  ${args.apply ? "Atualizadas" : "Atualizaria"}: ${atualizadas}`);
  console.log(`  Sem finance tx: ${semFinanceTx}`);
  console.log(`  Sem item-match no payload: ${semItemMatch}`);
  console.log(`  Sem AmazonFees no breakdown: ${semAmazonFees}`);

  if (exemplos.length > 0) {
    console.log(`\n=== Exemplos (até 5) ===`);
    console.table(
      exemplos.map((e) => ({
        orderId: e.orderId,
        sku: e.sku,
        bruto: money(e.bruto),
        taxas: money(e.taxas),
        fretes: money(e.fretes),
        liquido: money(e.liquido),
        status: e.statusFinanceiro,
      })),
    );
  }

  await db.$disconnect();
}

function extrairValoresDoPayload(
  payload: unknown,
  skuAlvo: string,
): {
  productCharges: number;
  amazonFees: number;
  shipping: number;
  totalAmount: number;
} | null {
  try {
    const tx = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!tx || typeof tx !== "object") return null;

    const items = readArray((tx as Record<string, unknown>).items);
    const itensValidos = items.filter(isRecord);
    const itemPreferido =
      itensValidos.find((i) => skuOfItem(i) === skuAlvo) ?? itensValidos[0];
    if (!itemPreferido) return null;

    const productCharges = Math.abs(
      findBreakdownAmountCentavos(itemPreferido, "ProductCharges"),
    );
    const amazonFees = Math.abs(
      findBreakdownAmountCentavos(itemPreferido, "AmazonFees"),
    );
    const shipping =
      Math.abs(findBreakdownAmountCentavos(itemPreferido, "ShippingCharge")) +
      Math.abs(findBreakdownAmountCentavos(itemPreferido, "ShippingChargeback"));

    const total =
      readNumber(
        ((itemPreferido.totalAmount as Record<string, unknown>) ?? {})
          .currencyAmount,
      ) ?? null;
    const totalAmount = total != null ? Math.round(total * 100) : 0;

    return { productCharges, amazonFees, shipping, totalAmount };
  } catch {
    return null;
  }
}

function skuOfItem(item: Record<string, unknown>): string | null {
  const direct =
    (item.sku as string | undefined) ??
    (item.sellerSku as string | undefined) ??
    (item.SellerSKU as string | undefined);
  if (direct) return direct;
  const contexts = readArray(item.contexts).filter(isRecord);
  for (const ctx of contexts) {
    const s = ctx.sku as string | undefined;
    if (s) return s;
  }
  return null;
}

function findBreakdownAmountCentavos(
  item: Record<string, unknown>,
  breakdownType: string,
): number {
  const breakdowns = readArray(item.breakdowns).filter(isRecord);
  for (const b of breakdowns) {
    if (b.breakdownType === breakdownType) {
      const amount = (b.breakdownAmount as Record<string, unknown>) ?? {};
      const value = readNumber(amount.currencyAmount);
      if (value != null) return Math.round(value * 100);
    }
  }
  return 0;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function money(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
