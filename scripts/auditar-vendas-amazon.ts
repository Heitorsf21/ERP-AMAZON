import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  calcularPrecoUnitarioCentavos,
  valorBrutoDaVenda,
  valorBrutoFinanceiroPodeAtualizar,
} from "@/modules/vendas/valores";

type Args = {
  dryRun: boolean;
  apply: boolean;
  allHistory: boolean;
  de?: string;
  ate?: string;
  orders: string[];
};

type VendaAudit = {
  id: string;
  amazonOrderId: string;
  sku: string;
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number | null;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number | null;
  dataVenda: Date;
};

type Candidate = {
  source:
    | "amazon_raw"
    | "finance"
    | "amazon_sku_unit"
    | "amazon_stored_unit";
  value: number;
};

const PEDIDOS_REFERENCIA = new Set([
  "701-8920528-0677816",
  "701-2475527-7680204",
]);

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    apply: false,
    allHistory: false,
    orders: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--all-history") args.allHistory = true;
    else if (arg === "--de") args.de = argv[++i];
    else if (arg === "--ate") args.ate = argv[++i];
    else if (arg === "--orders") {
      while (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
        args.orders.push(argv[++i]!.trim());
      }
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  if (args.apply && args.dryRun) {
    throw new Error("Use apenas um modo: --dry-run ou --apply.");
  }
  if (!args.apply) args.dryRun = true;
  if (!args.allHistory && !args.de && !args.ate && args.orders.length === 0) {
    throw new Error(
      "Informe um escopo: --all-history, --de/--ate ou --orders.",
    );
  }

  args.orders = [...new Set(args.orders.filter(Boolean))];
  return args;
}

function buildWhere(args: Args): Prisma.VendaAmazonWhereInput {
  const where: Prisma.VendaAmazonWhereInput = {};
  if (args.orders.length > 0) {
    where.amazonOrderId = { in: args.orders };
  }
  if (args.de || args.ate) {
    where.dataVenda = {};
    if (args.de) where.dataVenda.gte = new Date(`${args.de}T00:00:00.000Z`);
    if (args.ate) where.dataVenda.lte = new Date(`${args.ate}T23:59:59.999Z`);
  }
  return where;
}

function key(orderId: string, sku: string): string {
  return `${orderId}\u0000${sku}`;
}

function cents(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    const decimal =
      raw.includes(",") && !raw.includes(".")
        ? raw.replace(".", "").replace(",", ".")
        : raw.replace(/,/g, "");
    const parsed = Number(decimal.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  return null;
}

function moneyToCents(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  if (typeof value === "string") return cents(value);
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return moneyToCents(
    record.Amount ??
      record.amount ??
      record.Value ??
      record.value ??
      record.currencyAmount ??
      record.CurrencyAmount,
  );
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
  for (const k of keys) {
    const value = record[k];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sumMap(map: Map<string, number>, k: string, value: number | null) {
  if (value == null || value <= 0) return;
  map.set(k, (map.get(k) ?? 0) + value);
}

async function loadAmazonRawCandidates(orderIds: string[]) {
  const map = new Map<string, number>();
  if (orderIds.length === 0) return map;

  const raws = await db.amazonOrderRaw.findMany({
    where: { amazonOrderId: { in: orderIds } },
    select: { amazonOrderId: true, payloadJson: true },
  });

  for (const raw of raws) {
    const payload = readJson(raw.payloadJson);
    if (!payload) continue;

    if (isRecord(payload) && Array.isArray(payload.rows)) {
      for (const row of payload.rows) {
        if (!isRecord(row)) continue;
        const sku = readString(row, ["sku", "SellerSKU", "sellerSku"]);
        const total = cents(row.itemPriceCentavos);
        if (sku) sumMap(map, key(raw.amazonOrderId, sku), total);
      }
      continue;
    }

    visitRecords(payload, (record) => {
      const sku = readString(record, ["SellerSKU", "sellerSku", "sku"]);
      if (!sku) return;
      const total = moneyToCents(
        record.ItemPrice ?? record.itemPrice ?? record.price,
      );
      sumMap(map, key(raw.amazonOrderId, sku), total);
    });
  }

  return map;
}

async function loadFinanceCandidates(orderIds: string[]) {
  const map = new Map<string, number>();
  if (orderIds.length === 0) return map;

  const rows = await db.amazonFinanceTransaction.findMany({
    where: { amazonOrderId: { in: orderIds } },
    select: { amazonOrderId: true, payload: true },
  });

  for (const row of rows) {
    const orderId = row.amazonOrderId;
    if (!orderId) continue;
    const payload = readJson(row.payload);
    if (!payload) continue;

    visitRecords(payload, (record) => {
      const sku = readString(record, [
        "sku",
        "sellerSku",
        "SellerSKU",
        "sellerSKU",
      ]);
      if (!sku) return;

      const breakdowns = record.breakdowns;
      if (!Array.isArray(breakdowns)) return;
      for (const breakdown of breakdowns) {
        if (!isRecord(breakdown)) continue;
        const type = readString(breakdown, [
          "breakdownType",
          "type",
          "chargeType",
          "name",
        ]);
        if (type !== "ProductCharges") continue;
        sumMap(
          map,
          key(orderId, sku),
          moneyToCents(breakdown.breakdownAmount ?? breakdown.amount),
        );
      }
    });
  }

  return map;
}

async function loadSkuUnitCandidates(skus: string[]) {
  const map = new Map<string, number>();
  if (skus.length === 0) return map;

  const rows = await db.vendaAmazon.findMany({
    where: {
      sku: { in: skus },
      quantidade: 1,
      valorBrutoCentavos: { gt: 0 },
    },
    select: { sku: true, valorBrutoCentavos: true },
  });

  const countsBySku = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const valor = row.valorBrutoCentavos;
    if (valor == null || valor <= 0) continue;

    const counts = countsBySku.get(row.sku) ?? new Map<number, number>();
    counts.set(valor, (counts.get(valor) ?? 0) + 1);
    countsBySku.set(row.sku, counts);
  }

  for (const [sku, counts] of countsBySku.entries()) {
    let bestValue = 0;
    let bestCount = 0;
    for (const [value, count] of counts.entries()) {
      if (count > bestCount || (count === bestCount && value > bestValue)) {
        bestValue = value;
        bestCount = count;
      }
    }
    if (bestValue > 0) map.set(sku, bestValue);
  }

  return map;
}

function chooseTarget(
  venda: VendaAudit,
  candidates: Candidate[],
): { target: number | null; source: string } {
  const amazon = candidates.find((c) => c.source === "amazon_raw")?.value;
  const finance = candidates.find((c) => c.source === "finance")?.value;
  const storedUnit = candidates.find(
    (c) => c.source === "amazon_stored_unit",
  )?.value;
  const skuUnit = candidates.find((c) => c.source === "amazon_sku_unit")?.value;

  if (amazon != null) return { target: amazon, source: "amazon_raw" };

  if (
    finance != null &&
    valorBrutoFinanceiroPodeAtualizar({
      valorBrutoAtualCentavos: valorBrutoDaVenda(venda),
      quantidadeAtual: venda.quantidade,
      valorBrutoFinanceiroCentavos: finance,
    })
  ) {
    return { target: finance, source: "finance" };
  }

  if (skuUnit != null) return { target: skuUnit, source: "amazon_sku_unit" };
  if (storedUnit != null) {
    return { target: storedUnit, source: "amazon_stored_unit" };
  }

  return { target: null, source: "none" };
}

function amazonStoredUnitCandidate(venda: VendaAudit): number | null {
  if (venda.quantidade <= 1 || venda.precoUnitarioCentavos <= 0) return null;

  const totalPeloUnitario = venda.precoUnitarioCentavos * venda.quantidade;
  const brutoAtual = valorBrutoDaVenda(venda);
  if (totalPeloUnitario <= brutoAtual) return null;

  return totalPeloUnitario;
}

function amazonSkuUnitCandidate(
  venda: VendaAudit,
  unitarioCentavos?: number,
): number | null {
  if (
    venda.quantidade <= 1 ||
    unitarioCentavos == null ||
    unitarioCentavos <= 0
  ) {
    return null;
  }

  const brutoAtual = valorBrutoDaVenda(venda);
  if (brutoAtual > unitarioCentavos + 1) return null;

  const totalPeloSku = unitarioCentavos * venda.quantidade;
  if (totalPeloSku <= brutoAtual) return null;

  return totalPeloSku;
}

function liquidoCorrigido(
  venda: VendaAudit,
  brutoAtual: number,
  brutoNovo: number,
): number | undefined {
  const atual = venda.liquidoMarketplaceCentavos;
  if (atual == null) {
    return brutoNovo - venda.taxasCentavos - venda.fretesCentavos;
  }

  const antigoComFrete =
    brutoAtual - venda.taxasCentavos - venda.fretesCentavos;
  if (atual === antigoComFrete) {
    return brutoNovo - venda.taxasCentavos - venda.fretesCentavos;
  }

  const antigoSemFrete = brutoAtual - venda.taxasCentavos;
  if (atual === antigoSemFrete) {
    return brutoNovo - venda.taxasCentavos;
  }

  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vendas = await db.vendaAmazon.findMany({
    where: buildWhere(args),
    orderBy: [{ dataVenda: "asc" }, { amazonOrderId: "asc" }, { sku: "asc" }],
    select: {
      id: true,
      amazonOrderId: true,
      sku: true,
      quantidade: true,
      precoUnitarioCentavos: true,
      valorBrutoCentavos: true,
      taxasCentavos: true,
      fretesCentavos: true,
      liquidoMarketplaceCentavos: true,
      dataVenda: true,
    },
  });

  const orderIds = [...new Set(vendas.map((v) => v.amazonOrderId))];
  const skus = [...new Set(vendas.map((v) => v.sku).filter(Boolean))];
  const [amazonRaw, finance, skuUnit] = await Promise.all([
    loadAmazonRawCandidates(orderIds),
    loadFinanceCandidates(orderIds),
    loadSkuUnitCandidates(skus),
  ]);

  let semReferencia = 0;
  let semMudanca = 0;
  let corrigiveis = 0;
  let aplicadas = 0;

  console.log(
    `[amazon:vendas:audit] modo=${args.apply ? "apply" : "dry-run"} fonte=amazon_api vendas=${vendas.length}`,
  );

  for (const venda of vendas) {
    const k = key(venda.amazonOrderId, venda.sku);
    const candidates: Candidate[] = [
      ["amazon_raw", amazonRaw.get(k)],
      ["finance", finance.get(k)],
      [
        "amazon_sku_unit",
        amazonSkuUnitCandidate(venda, skuUnit.get(venda.sku)),
      ],
      ["amazon_stored_unit", amazonStoredUnitCandidate(venda)],
    ]
      .filter(
        (entry): entry is [Candidate["source"], number] => entry[1] != null,
      )
      .map(([source, value]) => ({ source, value }));
    const choice = chooseTarget(venda, candidates);
    const brutoAtual = valorBrutoDaVenda(venda);

    if (choice.target == null) {
      semReferencia++;
      if (PEDIDOS_REFERENCIA.has(venda.amazonOrderId)) {
        console.log(
          `[SEM_REFERENCIA] ${venda.amazonOrderId} ${venda.sku}: brutoAtual=${brutoAtual}`,
        );
      }
      continue;
    }

    const novoPreco = calcularPrecoUnitarioCentavos(
      choice.target,
      venda.quantidade,
    );
    const precisaCorrigir =
      brutoAtual !== choice.target ||
      venda.valorBrutoCentavos == null ||
      venda.precoUnitarioCentavos !== novoPreco;

    if (!precisaCorrigir) {
      semMudanca++;
      if (PEDIDOS_REFERENCIA.has(venda.amazonOrderId)) {
        console.log(
          `[OK] ${venda.amazonOrderId} ${venda.sku}: bruto=${brutoAtual} fonte=${choice.source}`,
        );
      }
      continue;
    }

    corrigiveis++;
    const novoLiquido = liquidoCorrigido(venda, brutoAtual, choice.target);
    console.log(
      `[CORRIGIR] ${venda.amazonOrderId} ${venda.sku}: qtd=${venda.quantidade} bruto ${brutoAtual} -> ${choice.target} unit ${venda.precoUnitarioCentavos} -> ${novoPreco} fonte=${choice.source}`,
    );

    if (args.apply) {
      await db.vendaAmazon.update({
        where: { id: venda.id },
        data: {
          valorBrutoCentavos: choice.target,
          precoUnitarioCentavos: novoPreco,
          ...(novoLiquido == null
            ? {}
            : { liquidoMarketplaceCentavos: novoLiquido }),
          ultimaSyncEm: new Date(),
        },
      });
      aplicadas++;
    }
  }

  console.log("\n=== RESUMO ===");
  console.log(`Sem mudanca: ${semMudanca}`);
  console.log(`Corrigiveis: ${corrigiveis}`);
  console.log(`Aplicadas: ${aplicadas}`);
  console.log(`Sem referencia: ${semReferencia}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
