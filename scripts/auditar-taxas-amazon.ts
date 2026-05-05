import { Prisma } from "@prisma/client";
import { decryptConfigValue } from "@/lib/crypto";
import { db } from "@/lib/db";
import {
  listFinancialTransactions,
  type SPAPICredentials,
  type SPFinanceTransaction,
} from "@/lib/amazon-sp-api";
import { valorBrutoDaVenda } from "@/modules/vendas/valores";

type Args = {
  orderId: string;
  sku?: string;
  live: boolean;
  diasAntes: number;
  diasDepois: number;
  maxPages: number;
};

type VendaTaxa = {
  amazonOrderId: string;
  sku: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number | null;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number | null;
  statusFinanceiro: string;
  liquidacaoId: string | null;
  dataVenda: Date;
};

type FinanceItem = {
  source: "stored" | "live";
  skuFallback: boolean;
  transactionId: string;
  postedDate: Date | null;
  transactionType: string | null;
  transactionStatus: string | null;
  totalAmountCentavos: number | null;
  sku: string;
  productChargesCentavos: number;
  amazonFeesCentavos: number;
  feeFallbackCentavos: number;
  shippingCentavos: number;
  netCentavos: number;
  feeBreakdowns: Array<{ type: string; amountCentavos: number }>;
};

type FinanceTransactionRow = {
  transactionId: string;
  postedDate: Date | null;
  transactionType: string | null;
  transactionStatus: string | null;
  totalAmountCentavos: number | null;
  payload: Prisma.JsonValue;
};

function parseArgs(argv: string[]): Args {
  const orderIndex = argv.findIndex((arg) => arg === "--order");
  const orderId = orderIndex >= 0 ? argv[orderIndex + 1]?.trim() : argv[0]?.trim();
  if (!orderId) {
    throw new Error("Informe o pedido: --order 701-...");
  }

  const skuIndex = argv.findIndex((arg) => arg === "--sku");
  const sku = skuIndex >= 0 ? argv[skuIndex + 1]?.trim() : undefined;

  return {
    orderId,
    sku,
    live: argv.includes("--live"),
    diasAntes: readNumberArg(argv, "--dias-antes", 2),
    diasDepois: readNumberArg(argv, "--dias-depois", 14),
    maxPages: readNumberArg(argv, "--max-pages", 20),
  };
}

function readNumberArg(argv: string[], name: string, fallback: number): number {
  const index = argv.findIndex((arg) => arg === name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function brl(centavos?: number | null): string {
  const valor = (centavos ?? 0) / 100;
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function visitRecords(
  value: unknown,
  fn: (record: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, fn);
    return;
  }
  if (!isRecord(value)) return;
  fn(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") visitRecords(child, fn);
  }
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeKind(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function amountToCents(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return 0;
    const decimal =
      raw.includes(",") && !raw.includes(".")
        ? raw.replace(".", "").replace(",", ".")
        : raw.replace(/,/g, "");
    const parsed = Number(decimal.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  if (!isRecord(value)) return 0;
  return amountToCents(
    value.currencyAmount ??
      value.CurrencyAmount ??
      value.totalAmount ??
      value.TotalAmount ??
      value.amount ??
      value.Amount ??
      value.value ??
      value.Value,
  );
}

function topBreakdownAmount(item: unknown, breakdownType: string): number {
  if (!isRecord(item) || !Array.isArray(item.breakdowns)) return 0;
  for (const breakdown of item.breakdowns) {
    if (!isRecord(breakdown)) continue;
    const type = readString(breakdown, [
      "breakdownType",
      "type",
      "chargeType",
      "feeType",
      "name",
    ]);
    if (type !== breakdownType) continue;
    return amountToCents(
      breakdown.breakdownAmount ??
        breakdown.amount ??
        breakdown.Amount ??
        breakdown.value ??
        breakdown.Value,
    );
  }
  return 0;
}

function sumTopBreakdowns(item: unknown, breakdownTypes: string[]): number {
  return breakdownTypes.reduce(
    (sum, type) => sum + topBreakdownAmount(item, type),
    0,
  );
}

function sumFeeFallback(value: unknown): number {
  let total = 0;
  visitRecords(value, (record) => {
    const type = normalizeKind(
      readString(record, [
        "breakdownType",
        "type",
        "chargeType",
        "feeType",
        "name",
      ]),
    );
    if (!type.includes("fee")) return;
    total += amountToCents(
      record.breakdownAmount ??
        record.amount ??
        record.Amount ??
        record.value ??
        record.Value,
    );
  });
  return total;
}

function getFinanceItems(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) return [];

  for (const key of [
    "items",
    "Items",
    "ItemList",
    "shipmentItems",
    "ShipmentItems",
    "refundItems",
    "RefundItems",
    "transactionItems",
    "TransactionItems",
  ]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  const found: Record<string, unknown>[] = [];
  visitRecords(payload, (record) => {
    const sku = readString(record, [
      "sku",
      "sellerSku",
      "SellerSKU",
      "sellerSKU",
      "merchantSku",
    ]);
    if (sku && Array.isArray(record.breakdowns)) found.push(record);
  });
  return found;
}

function readDeepString(value: unknown, keys: string[]): string | null {
  let found: string | null = null;
  visitRecords(value, (record) => {
    if (found) return;
    found = readString(record, keys);
  });
  return found;
}

function findOrderId(transaction: unknown, item?: unknown): string | null {
  if (isRecord(item)) {
    const fromItem = readDeepString(item, [
      "amazonOrderId",
      "AmazonOrderId",
      "orderId",
      "OrderId",
    ]);
    if (fromItem) return fromItem;
  }

  if (!isRecord(transaction)) return null;

  const fromTransaction = readDeepString(transaction, [
    "amazonOrderId",
    "AmazonOrderId",
    "orderId",
    "OrderId",
  ]);
  if (fromTransaction) return fromTransaction;

  const related = transaction.relatedIdentifiers;
  if (!Array.isArray(related)) return null;
  for (const identifier of related) {
    if (!isRecord(identifier)) continue;
    const name = normalizeKind(
      readString(identifier, ["relatedIdentifierName", "name", "type"]),
    );
    if (!name.includes("order")) continue;
    const value = readString(identifier, ["relatedIdentifierValue", "value"]);
    if (value) return value;
  }

  return null;
}

async function loadCredentials(): Promise<SPAPICredentials | null> {
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "amazon_" } },
    select: { chave: true, valor: true },
  });
  const cfg: Record<string, string> = {};
  for (const row of rows) cfg[row.chave] = decryptConfigValue(row.valor) ?? "";

  cfg.amazon_client_id ||= process.env.AMAZON_LWA_CLIENT_ID ?? "";
  cfg.amazon_client_secret ||= process.env.AMAZON_LWA_CLIENT_SECRET ?? "";
  cfg.amazon_refresh_token ||= process.env.AMAZON_LWA_REFRESH_TOKEN ?? "";
  cfg.amazon_marketplace_id ||=
    process.env.AMAZON_MARKETPLACE_ID ?? "A2Q3Y263D00KWC";
  cfg.amazon_endpoint ||=
    process.env.AMAZON_SP_API_ENDPOINT ??
    "https://sellingpartnerapi-na.amazon.com";

  if (
    !cfg.amazon_client_id ||
    !cfg.amazon_client_secret ||
    !cfg.amazon_refresh_token ||
    !cfg.amazon_marketplace_id
  ) {
    return null;
  }

  return {
    clientId: cfg.amazon_client_id,
    clientSecret: cfg.amazon_client_secret,
    refreshToken: cfg.amazon_refresh_token,
    marketplaceId: cfg.amazon_marketplace_id,
    endpoint: cfg.amazon_endpoint || undefined,
  };
}

async function loadStoredTransactions(orderId: string) {
  try {
    return await db.$queryRaw<FinanceTransactionRow[]>`
      SELECT
        "transactionId",
        "postedDate",
        "transactionType",
        "transactionStatus",
        "totalAmountCentavos",
        payload
      FROM "AmazonFinanceTransaction"
      WHERE "amazonOrderId" = ${orderId}
         OR payload::text ILIKE ${`%${orderId}%`}
      ORDER BY "postedDate" ASC NULLS LAST, "transactionId" ASC
    `;
  } catch {
    return db.amazonFinanceTransaction.findMany({
      where: { amazonOrderId: orderId },
      orderBy: [{ postedDate: "asc" }, { transactionId: "asc" }],
      select: {
        transactionId: true,
        postedDate: true,
        transactionType: true,
        transactionStatus: true,
        totalAmountCentavos: true,
        payload: true,
      },
    });
  }
}

function transactionRowFromLive(
  transaction: SPFinanceTransaction,
  index: number,
): FinanceTransactionRow {
  return {
    transactionId: transaction.transactionId ?? `live:${index}`,
    postedDate: transaction.postedDate ? new Date(transaction.postedDate) : null,
    transactionType: transaction.transactionType ?? null,
    transactionStatus: transaction.transactionStatus ?? null,
    totalAmountCentavos: amountToCents(transaction.totalAmount) || null,
    payload: transaction as Prisma.JsonValue,
  };
}

async function loadLiveTransactions(args: Args, vendas: VendaTaxa[]) {
  if (!args.live) return [];

  const creds = await loadCredentials();
  if (!creds) throw new Error("Credenciais Amazon SP-API nao configuradas.");

  const baseDate = vendas[0]?.dataVenda ?? new Date();
  const postedAfter = new Date(baseDate);
  postedAfter.setDate(postedAfter.getDate() - args.diasAntes);

  const postedBefore = new Date(baseDate);
  postedBefore.setDate(postedBefore.getDate() + args.diasDepois);
  const safeNow = new Date(Date.now() - 3 * 60_000);
  const cappedBefore = postedBefore > safeNow ? safeNow : postedBefore;

  console.log(
    `[live] buscando Transactions API de ${postedAfter.toISOString()} ate ${cappedBefore.toISOString()} maxPages=${args.maxPages}`,
  );

  const transactions = await listFinancialTransactions(
    creds,
    postedAfter,
    cappedBefore,
    100,
    { maxPages: args.maxPages },
  );
  const filtered = transactions.filter((transaction) => {
    if (findOrderId(transaction) === args.orderId) return true;
    return JSON.stringify(transaction).includes(args.orderId);
  });

  console.log(
    `[live] transacoes lidas=${transactions.length} transacoes do pedido=${filtered.length}`,
  );

  return filtered.map(transactionRowFromLive);
}

function financeItemFromTransaction(
  row: {
  source?: "stored" | "live";
  transactionId: string;
  postedDate: Date | null;
  transactionType: string | null;
  transactionStatus: string | null;
  totalAmountCentavos: number | null;
  payload: Prisma.JsonValue;
  },
  context: { orderId: string; fallbackSku?: string },
): FinanceItem[] {
  const payload = readJson(row.payload);
  const items = getFinanceItems(payload);
  const candidates = items.length > 0 || !isRecord(payload) ? items : [payload];

  return candidates.flatMap((item) => {
    let sku = readString(item, [
      "sku",
      "sellerSku",
      "SellerSKU",
      "sellerSKU",
      "merchantSku",
    ]);
    const orderId = findOrderId(payload, item);
    const skuFallback =
      !sku && orderId === context.orderId && !!context.fallbackSku;
    if (!sku && skuFallback) sku = context.fallbackSku ?? null;
    if (!sku) return [];

    const amazonFeesCentavos = topBreakdownAmount(item, "AmazonFees");
    const feeFallbackCentavos = sumFeeFallback(item);
    const feeBreakdowns = Array.isArray(item.breakdowns)
      ? item.breakdowns
          .filter(isRecord)
          .flatMap((breakdown) => {
            const type = readString(breakdown, [
              "breakdownType",
              "type",
              "chargeType",
              "feeType",
              "name",
            ]);
            const nested = Array.isArray(breakdown.breakdowns)
              ? breakdown.breakdowns
              : [];
            if (type === "AmazonFees") {
              return nested.filter(isRecord).map((child) => ({
                type:
                  readString(child, [
                    "breakdownType",
                    "type",
                    "chargeType",
                    "feeType",
                    "name",
                  ]) ?? "fee",
                amountCentavos: amountToCents(
                  child.breakdownAmount ??
                    child.amount ??
                    child.Amount ??
                    child.value ??
                    child.Value,
                ),
              }));
            }
            if (!normalizeKind(type).includes("fee")) return [];
            return [
              {
                type: type ?? "fee",
                amountCentavos: amountToCents(
                  breakdown.breakdownAmount ??
                    breakdown.amount ??
                    breakdown.Amount ??
                    breakdown.value ??
                    breakdown.Value,
                ),
              },
            ];
          })
      : [];

    return [
      {
        source: row.source ?? "stored",
        skuFallback,
        transactionId: row.transactionId,
        postedDate: row.postedDate,
        transactionType: row.transactionType,
        transactionStatus: row.transactionStatus,
        totalAmountCentavos: row.totalAmountCentavos,
        sku,
        productChargesCentavos: topBreakdownAmount(item, "ProductCharges"),
        amazonFeesCentavos,
        feeFallbackCentavos,
        shippingCentavos: sumTopBreakdowns(item, [
          "ShippingChargeback",
          "ShippingCharge",
          "Shipping",
        ]),
        netCentavos: amountToCents(item),
        feeBreakdowns,
      },
    ];
  });
}

function printVenda(venda: VendaTaxa) {
  const bruto = valorBrutoDaVenda(venda);
  const liquidoCalculado =
    bruto - venda.taxasCentavos - venda.fretesCentavos;
  console.log(
    [
      `${venda.amazonOrderId} ${venda.sku}`,
      `qtd=${venda.quantidade}`,
      `bruto=${brl(bruto)}`,
      `taxasERP=${brl(venda.taxasCentavos)}`,
      `freteERP=${brl(venda.fretesCentavos)}`,
      `liquidoERP=${brl(venda.liquidoMarketplaceCentavos)}`,
      `liquidoCalc=${brl(liquidoCalculado)}`,
      `status=${venda.statusFinanceiro}`,
      `liquidacao=${venda.liquidacaoId ?? "-"}`,
    ].join(" | "),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vendas = await db.vendaAmazon.findMany({
    where: {
      amazonOrderId: args.orderId,
      ...(args.sku ? { sku: args.sku } : {}),
    },
    orderBy: [{ sku: "asc" }],
    select: {
      amazonOrderId: true,
      sku: true,
      quantidade: true,
      precoUnitarioCentavos: true,
      valorBrutoCentavos: true,
      taxasCentavos: true,
      fretesCentavos: true,
      liquidoMarketplaceCentavos: true,
      statusFinanceiro: true,
      liquidacaoId: true,
      dataVenda: true,
    },
  });

  const [storedTransactions, liveTransactions] = await Promise.all([
    loadStoredTransactions(args.orderId),
    loadLiveTransactions(args, vendas),
  ]);
  const liveIds = new Set(liveTransactions.map((row) => row.transactionId));
  const transactions = [
    ...storedTransactions
      .filter((row) => !liveIds.has(row.transactionId))
      .map((row) => ({ ...row, source: "stored" as const })),
    ...liveTransactions.map((row) => ({ ...row, source: "live" as const })),
  ];
  const skusDaVenda = [...new Set(vendas.map((venda) => venda.sku))];
  const fallbackSku = skusDaVenda.length === 1 ? skusDaVenda[0] : undefined;

  const financeItems = transactions
    .flatMap((transaction) =>
      financeItemFromTransaction(transaction, {
        orderId: args.orderId,
        fallbackSku,
      }),
    )
    .filter((item) => !args.sku || item.sku === args.sku);

  console.log(`[amazon:taxas:audit] pedido=${args.orderId}`);
  console.log(`vendas=${vendas.length} transacoes=${transactions.length}`);
  console.log("");

  if (vendas.length === 0) {
    console.log("Nenhuma venda encontrada para esse pedido.");
  } else {
    console.log("=== ERP ===");
    for (const venda of vendas) printVenda(venda);
  }

  console.log("");
  console.log("=== Amazon Finance API ===");
  if (financeItems.length === 0) {
    console.log("Nenhum item financeiro encontrado para comparar taxas.");
  }

  for (const item of financeItems) {
    const taxaAmazon = Math.abs(
      item.amazonFeesCentavos || item.feeFallbackCentavos,
    );
    console.log(
      [
        `${item.source}:${item.transactionId} ${item.sku}${
          item.skuFallback ? " (sku inferido pelo pedido)" : ""
        }`,
        `posted=${item.postedDate?.toISOString() ?? "-"}`,
        `tipo=${item.transactionType ?? "-"}`,
        `status=${item.transactionStatus ?? "-"}`,
        `brutoAmazon=${brl(item.productChargesCentavos)}`,
        `taxasAmazon=${brl(taxaAmazon)}`,
        `freteAmazon=${brl(Math.abs(item.shippingCentavos))}`,
        `liquidoAmazon=${brl(item.netCentavos)}`,
      ].join(" | "),
    );
    for (const fee of item.feeBreakdowns) {
      console.log(`  - ${fee.type}: ${brl(fee.amountCentavos)}`);
    }
  }

  console.log("");
  console.log("=== Comparacao ===");
  for (const venda of vendas) {
    const itensSku = financeItems.filter((item) => item.sku === venda.sku);
    const taxasAmazon = itensSku.reduce(
      (sum, item) =>
        sum + Math.abs(item.amazonFeesCentavos || item.feeFallbackCentavos),
      0,
    );
    const freteAmazon = itensSku.reduce(
      (sum, item) => sum + Math.abs(item.shippingCentavos),
      0,
    );
    const liquidoAmazon = itensSku.reduce(
      (sum, item) => sum + item.netCentavos,
      0,
    );
    const diffTaxas = venda.taxasCentavos - taxasAmazon;
    const diffFrete = venda.fretesCentavos - freteAmazon;
    const diffLiquido =
      (venda.liquidoMarketplaceCentavos ?? 0) - liquidoAmazon;
    const okTaxas = diffTaxas === 0 ? "OK" : "DIVERGENTE";

    console.log(
      [
        `${venda.sku}: ${okTaxas}`,
        `taxasERP=${brl(venda.taxasCentavos)}`,
        `taxasAmazon=${brl(taxasAmazon)}`,
        `diff=${brl(diffTaxas)}`,
        `freteDiff=${brl(diffFrete)}`,
        `liquidoDiff=${brl(diffLiquido)}`,
      ].join(" | "),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
