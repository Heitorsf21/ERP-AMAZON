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
  orderId?: string;
  sku?: string;
  live: boolean;
  scan: boolean;
  de?: string;
  ate?: string;
  diasAntes: number;
  diasDepois: number;
  maxPages: number;
  limit: number;
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
  comissaoCentavos: number;
  fbaCentavos: number;
  parcelamentoCentavos: number;
  closingFeeCentavos: number;
  taxasNaoDetalhadasCentavos: number;
  freteRecebidoCentavos: number;
  fretePagoCentavos: number;
  freteLiquidoCentavos: number;
  descontoFreteCentavos: number;
  promoRebatesCentavos: number;
  impactoFreteCentavos: number;
  taxasAmazonTotalCentavos: number;
  amazonFeesSemSubBreakdown: boolean;
  fbaLikeNaoReconhecido: string[];
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
  const orderId =
    orderIndex >= 0
      ? argv[orderIndex + 1]?.trim()
      : argv[0] && !argv[0].startsWith("--")
        ? argv[0].trim()
        : undefined;
  const scan = argv.includes("--scan");
  if (!orderId && !scan) throw new Error("Informe o pedido: --order 701-... ou use --scan");

  const skuIndex = argv.findIndex((arg) => arg === "--sku");
  const sku = skuIndex >= 0 ? argv[skuIndex + 1]?.trim() : undefined;

  return {
    orderId,
    sku,
    live: argv.includes("--live"),
    scan,
    de: readStringArg(argv, "--de"),
    ate: readStringArg(argv, "--ate"),
    diasAntes: readNumberArg(argv, "--dias-antes", 2),
    diasDepois: readNumberArg(argv, "--dias-depois", 14),
    maxPages: readNumberArg(argv, "--max-pages", 20),
    limit: readNumberArg(argv, "--limit", 5000),
  };
}

function readStringArg(argv: string[], name: string): string | undefined {
  const index = argv.findIndex((arg) => arg === name);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  return value && !value.startsWith("--") ? value : undefined;
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

type FeesClassificadas = Pick<
  FinanceItem,
  | "comissaoCentavos"
  | "fbaCentavos"
  | "parcelamentoCentavos"
  | "closingFeeCentavos"
  | "taxasNaoDetalhadasCentavos"
  | "taxasAmazonTotalCentavos"
  | "amazonFeesSemSubBreakdown"
  | "fbaLikeNaoReconhecido"
>;

function classificarFeesFinanceiras(input: {
  amazonFeesCentavos: number;
  feeFallbackCentavos: number;
  feeBreakdowns: Array<{ type: string; amountCentavos: number }>;
}): FeesClassificadas {
  const amazonFeesAbs = Math.abs(input.amazonFeesCentavos);
  const fallbackAbs = Math.abs(input.feeFallbackCentavos);
  const semSubBreakdown =
    amazonFeesAbs > 0 && input.feeBreakdowns.length === 0;
  const result: FeesClassificadas = {
    comissaoCentavos: 0,
    fbaCentavos: 0,
    parcelamentoCentavos: 0,
    closingFeeCentavos: 0,
    taxasNaoDetalhadasCentavos: semSubBreakdown
      ? amazonFeesAbs
      : amazonFeesAbs <= 0 && fallbackAbs > 0
        ? fallbackAbs
        : 0,
    taxasAmazonTotalCentavos: amazonFeesAbs || fallbackAbs,
    amazonFeesSemSubBreakdown: semSubBreakdown,
    fbaLikeNaoReconhecido: [],
  };

  if (semSubBreakdown || input.feeBreakdowns.length === 0) return result;

  for (const fee of input.feeBreakdowns) {
    const valor = Math.abs(fee.amountCentavos);
    if (valor <= 0) continue;

    if (matchesCommissionType(fee.type)) {
      result.comissaoCentavos += valor;
    } else if (matchesFbaType(fee.type)) {
      result.fbaCentavos += valor;
    } else if (matchesParcelamentoType(fee.type)) {
      result.parcelamentoCentavos += valor;
    } else if (matchesClosingFeeType(fee.type)) {
      result.closingFeeCentavos += valor;
    } else {
      result.taxasNaoDetalhadasCentavos += valor;
      if (looksLikeFbaType(fee.type)) {
        result.fbaLikeNaoReconhecido.push(fee.type);
      }
    }
  }

  const somaClassificada =
    result.comissaoCentavos +
    result.fbaCentavos +
    result.parcelamentoCentavos +
    result.closingFeeCentavos +
    result.taxasNaoDetalhadasCentavos;
  result.taxasAmazonTotalCentavos = amazonFeesAbs || somaClassificada;
  return result;
}

function normalizeFeeType(type: string): string {
  return type.toLowerCase().replace(/[^a-z]/g, "");
}

function matchesCommissionType(type: string): boolean {
  const t = type.toLowerCase();
  return t === "commission" || t === "referralfee" || t === "referral fee";
}

function matchesFbaType(type: string): boolean {
  const t = normalizeFeeType(type);
  return (
    t === "fbafulfillmentfee" ||
    t === "fbafulfillmentfees" ||
    t === "fbafee" ||
    t === "fbafees" ||
    t === "fulfillmentfee" ||
    t === "fulfillmentfees" ||
    t === "fbatransactionfee" ||
    t === "fbaperunitfulfillmentfee" ||
    t === "fbaperorderfulfillmentfee" ||
    t === "fbamultitierperunitfee" ||
    t.startsWith("fbafulfill") ||
    (t.startsWith("fba") && (t.endsWith("fee") || t.endsWith("fees")))
  );
}

function matchesParcelamentoType(type: string): boolean {
  const t = normalizeFeeType(type);
  return t === "amazonforallfee" || t === "installmentfee";
}

function matchesClosingFeeType(type: string): boolean {
  const t = normalizeFeeType(type);
  return (
    t === "closingfee" ||
    t === "variableclosingfee" ||
    t === "fixedclosingfee"
  );
}

function looksLikeFbaType(type: string): boolean {
  const t = normalizeFeeType(type);
  return t.includes("fba") || t.includes("fulfillment");
}

function matchesShippingDiscountType(type: string | null | undefined): boolean {
  const t = normalizeFeeType(type ?? "");
  return (
    t === "shippingdiscount" ||
    t === "shippingpromotiondiscount" ||
    t === "shippingpromotionaldiscount"
  );
}

function classificarPromoRebatesDoItem(item: unknown): {
  promoRebatesCentavos: number;
  descontoFreteCentavos: number;
} {
  if (!isRecord(item) || !Array.isArray(item.breakdowns)) {
    return { promoRebatesCentavos: 0, descontoFreteCentavos: 0 };
  }

  let promoRebatesCentavos = 0;
  let descontoFreteCentavos = 0;

  for (const breakdown of item.breakdowns) {
    if (!isRecord(breakdown)) continue;
    const type = readString(breakdown, [
      "breakdownType",
      "type",
      "chargeType",
      "feeType",
      "name",
    ]);
    if (type !== "PromoRebates" && type !== "PromoRebateAccrued") continue;

    const total = Math.abs(
      amountToCents(
        breakdown.breakdownAmount ??
          breakdown.amount ??
          breakdown.Amount ??
          breakdown.value ??
          breakdown.Value,
      ),
    );
    const nested = Array.isArray(breakdown.breakdowns)
      ? breakdown.breakdowns.filter(isRecord)
      : [];
    if (nested.length === 0) {
      promoRebatesCentavos += total;
      continue;
    }

    let subtotal = 0;
    for (const child of nested) {
      const childType = readString(child, [
        "breakdownType",
        "type",
        "chargeType",
        "feeType",
        "name",
      ]);
      const value = Math.abs(
        amountToCents(
          child.breakdownAmount ??
            child.amount ??
            child.Amount ??
            child.value ??
            child.Value,
        ),
      );
      subtotal += value;
      if (matchesShippingDiscountType(childType)) {
        descontoFreteCentavos += value;
      } else {
        promoRebatesCentavos += value;
      }
    }

    promoRebatesCentavos += Math.max(0, total - subtotal);
  }

  return { promoRebatesCentavos, descontoFreteCentavos };
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
  if (!args.orderId) throw new Error("--live exige --order");
  const orderId = args.orderId;

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
    if (findOrderId(transaction) === orderId) return true;
    return JSON.stringify(transaction).includes(orderId);
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
    const fees = classificarFeesFinanceiras({
      amazonFeesCentavos,
      feeFallbackCentavos,
      feeBreakdowns,
    });
    const freteRecebidoCentavos = Math.abs(
      sumTopBreakdowns(item, ["ShippingCharge", "Shipping"]),
    );
    const fretePagoCentavos = Math.abs(
      sumTopBreakdowns(item, ["ShippingChargeback"]),
    );
    const promo = classificarPromoRebatesDoItem(item);
    const freteLiquidoCentavos = freteRecebidoCentavos - fretePagoCentavos;

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
        shippingCentavos: freteLiquidoCentavos,
        netCentavos: amountToCents(item),
        feeBreakdowns,
        ...fees,
        freteRecebidoCentavos,
        fretePagoCentavos,
        freteLiquidoCentavos,
        descontoFreteCentavos: promo.descontoFreteCentavos,
        promoRebatesCentavos: promo.promoRebatesCentavos,
        impactoFreteCentavos:
          freteLiquidoCentavos - promo.descontoFreteCentavos,
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

function resolverPeriodoScan(args: Args): { de: Date; ate: Date } {
  const ate = args.ate ? new Date(`${args.ate}T23:59:59.999Z`) : new Date();
  const de = args.de
    ? new Date(`${args.de}T00:00:00.000Z`)
    : new Date(ate.getTime() - 14 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(de.getTime()) || !Number.isFinite(ate.getTime())) {
    throw new Error("Periodo invalido. Use --de YYYY-MM-DD --ate YYYY-MM-DD.");
  }
  return { de, ate };
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function runScan(args: Args) {
  const { de, ate } = resolverPeriodoScan(args);
  const vendas = await db.vendaAmazon.findMany({
    where: {
      dataVenda: { gte: de, lte: ate },
      ...(args.sku ? { sku: args.sku } : {}),
    },
    orderBy: [{ dataVenda: "desc" }],
    take: args.limit,
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

  const orderIds = [...new Set(vendas.map((venda) => venda.amazonOrderId))];
  const skusPorOrder = new Map<string, Set<string>>();
  for (const venda of vendas) {
    const set = skusPorOrder.get(venda.amazonOrderId) ?? new Set<string>();
    set.add(venda.sku);
    skusPorOrder.set(venda.amazonOrderId, set);
  }

  type ScanTxRow = FinanceTransactionRow & { amazonOrderId: string | null };
  const txs: ScanTxRow[] = [];
  for (const ids of chunk(orderIds, 500)) {
    txs.push(
      ...(await db.amazonFinanceTransaction.findMany({
        where: { amazonOrderId: { in: ids } },
        orderBy: [{ postedDate: "asc" }, { transactionId: "asc" }],
        select: {
          amazonOrderId: true,
          transactionId: true,
          postedDate: true,
          transactionType: true,
          transactionStatus: true,
          totalAmountCentavos: true,
          payload: true,
        },
      })),
    );
  }

  const financeItems = txs.flatMap((tx) => {
    const orderId = tx.amazonOrderId ?? findOrderId(readJson(tx.payload)) ?? "";
    const skus = skusPorOrder.get(orderId);
    const fallbackSku = skus && skus.size === 1 ? [...skus][0] : undefined;
    return financeItemFromTransaction(
      { ...tx, source: "stored" as const },
      { orderId, fallbackSku },
    );
  });

  const ordersComAmazonFeesSemSub = new Set<string>();
  const ordersComFbaLikeNaoReconhecido = new Set<string>();
  const ordersComFreteRecebido = new Set<string>();
  const ordersComDescontoFrete = new Set<string>();
  const ordersComImpactoFretePositivo = new Set<string>();
  const gruposShipment = new Map<string, { total: number; statuses: Set<string> }>();

  for (const item of financeItems) {
    const orderId = findOrderId(readJson(
      txs.find((tx) => tx.transactionId === item.transactionId)?.payload,
    )) ?? txs.find((tx) => tx.transactionId === item.transactionId)?.amazonOrderId ?? "";
    const orderSku = `${orderId}\u0000${item.sku}`;

    if (item.amazonFeesSemSubBreakdown) ordersComAmazonFeesSemSub.add(orderSku);
    if (item.fbaLikeNaoReconhecido.length > 0) {
      ordersComFbaLikeNaoReconhecido.add(orderSku);
    }
    if (item.freteRecebidoCentavos > 0) ordersComFreteRecebido.add(orderSku);
    if (item.descontoFreteCentavos > 0) ordersComDescontoFrete.add(orderSku);
    if (item.impactoFreteCentavos > 0) {
      ordersComImpactoFretePositivo.add(orderSku);
    }

    const tipo = normalizeKind(item.transactionType);
    if (tipo.includes("shipment")) {
      const grupo = gruposShipment.get(orderSku) ?? {
        total: 0,
        statuses: new Set<string>(),
      };
      grupo.total += 1;
      grupo.statuses.add(item.transactionStatus ?? "(sem status)");
      gruposShipment.set(orderSku, grupo);
    }
  }

  const duplicidades = [...gruposShipment.entries()].filter(([, grupo]) => {
    if (grupo.total <= 1) return false;
    const statuses = [...grupo.statuses].map((s) => s.toUpperCase());
    return (
      statuses.some((s) => s.includes("DEFERRED")) &&
      statuses.some((s) => s.includes("RELEASED"))
    );
  });

  console.log("[amazon:taxas:audit --scan]");
  console.log(`periodo=${de.toISOString()}..${ate.toISOString()} limit=${args.limit}`);
  console.log(`vendas=${vendas.length} pedidos=${orderIds.length} transacoes=${txs.length} itensFinanceiros=${financeItems.length}`);
  console.table([
    {
      indicador: "AmazonFees sem sub-breakdown",
      pedidos_sku: ordersComAmazonFeesSemSub.size,
    },
    {
      indicador: "FBA-like nao reconhecido",
      pedidos_sku: ordersComFbaLikeNaoReconhecido.size,
    },
    {
      indicador: "Frete recebido",
      pedidos_sku: ordersComFreteRecebido.size,
    },
    {
      indicador: "Desconto de frete",
      pedidos_sku: ordersComDescontoFrete.size,
    },
    {
      indicador: "Frete com impacto positivo no lucro",
      pedidos_sku: ordersComImpactoFretePositivo.size,
    },
    {
      indicador: "Possivel duplicidade DEFERRED/RELEASED",
      pedidos_sku: duplicidades.length,
    },
  ]);

  if (duplicidades.length > 0) {
    console.log("\n=== Amostra duplicidades (ate 20) ===");
    console.table(
      duplicidades.slice(0, 20).map(([key, grupo]) => {
        const [orderId, sku] = key.split("\u0000");
        return {
          orderId,
          sku,
          transacoes: grupo.total,
          statuses: [...grupo.statuses].join(", "),
        };
      }),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.scan) {
    await runScan(args);
    return;
  }
  if (!args.orderId) throw new Error("Informe o pedido: --order 701-...");
  const orderId = args.orderId;

  const vendas = await db.vendaAmazon.findMany({
    where: {
      amazonOrderId: orderId,
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
    loadStoredTransactions(orderId),
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
        orderId,
        fallbackSku,
      }),
    )
    .filter((item) => !args.sku || item.sku === args.sku);

  console.log(`[amazon:taxas:audit] pedido=${orderId}`);
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
    console.log(
      [
        `${item.source}:${item.transactionId} ${item.sku}${
          item.skuFallback ? " (sku inferido pelo pedido)" : ""
        }`,
        `posted=${item.postedDate?.toISOString() ?? "-"}`,
        `tipo=${item.transactionType ?? "-"}`,
        `status=${item.transactionStatus ?? "-"}`,
        `brutoAmazon=${brl(item.productChargesCentavos)}`,
        `taxasAmazon=${brl(item.taxasAmazonTotalCentavos)}`,
        `comissao=${brl(item.comissaoCentavos)}`,
        `fba=${brl(item.fbaCentavos)}`,
        `parcelamento=${brl(item.parcelamentoCentavos)}`,
        `taxasNaoDetalhadas=${brl(item.taxasNaoDetalhadasCentavos)}`,
        `freteRecebido=${brl(item.freteRecebidoCentavos)}`,
        `fretePago=${brl(item.fretePagoCentavos)}`,
        `descontoFrete=${brl(item.descontoFreteCentavos)}`,
        `descontoOferta=${brl(item.promoRebatesCentavos)}`,
        `freteLiquido=${brl(item.freteLiquidoCentavos)}`,
        `impactoFrete=${brl(item.impactoFreteCentavos)}`,
        `liquidoAmazon=${brl(item.netCentavos)}`,
      ].join(" | "),
    );
    if (item.amazonFeesSemSubBreakdown) {
      console.log("  ! AmazonFees sem sub-breakdown: taxa mantida como nao detalhada.");
    }
    if (item.fbaLikeNaoReconhecido.length > 0) {
      console.log(
        `  ! FBA-like nao reconhecido: ${[...new Set(item.fbaLikeNaoReconhecido)].join(", ")}`,
      );
    }
    for (const fee of item.feeBreakdowns) {
      console.log(`  - ${fee.type}: ${brl(fee.amountCentavos)}`);
    }
  }

  console.log("");
  console.log("=== Comparacao ===");
  for (const venda of vendas) {
    const itensSku = financeItems.filter((item) => item.sku === venda.sku);
    const taxasAmazon = itensSku.reduce(
      (sum, item) => sum + item.taxasAmazonTotalCentavos,
      0,
    );
    const freteLiquidoAmazon = itensSku.reduce(
      (sum, item) => sum + item.freteLiquidoCentavos,
      0,
    );
    const liquidoAmazon = itensSku.reduce(
      (sum, item) => sum + item.netCentavos,
      0,
    );
    const diffTaxas = venda.taxasCentavos - taxasAmazon;
    const diffFrete = venda.fretesCentavos - Math.abs(freteLiquidoAmazon);
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
