/**
 * Recupera pedidos Amazon Pending/UNKNOWN com valorBrutoCentavos zerado.
 *
 * Modo seguro:
 *   --dry-run (default): nao escreve nada, apenas imprime o plano.
 *   --apply            : aplica as correcoes.
 *
 * Estrategia:
 *   1. Usa AmazonOrderRaw.payloadJson ja salvo no banco.
 *   2. Se o payload indicar quantityOrdered=0, marca como Cancelled.
 *   3. Se encontrar product.price.unitPrice.amount, recupera o valor real.
 *   4. Se necessario, consulta getOrderItems respeitando rate limit.
 *   5. Se ainda faltar valor, usa Produto.amazonPrecoListagemCentavos.
 *
 * Observacao: tambem audita Pending antigo com valor > 0, porque ele pode ter
 * virado QuantityOrdered=0 na Amazon depois do backfill inicial.
 */
import * as fs from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import {
  getOrderItems,
  type SPAPICredentials,
  type SPOrderItemDetail,
} from "@/lib/amazon-sp-api";
import { getAmazonConfig, isAmazonConfigured } from "@/modules/amazon/service";
import {
  STATUS_PEDIDO_PENDENTE,
  isVendaAmazonRemovalOrder,
} from "@/modules/vendas/filtros";

type Args = {
  apply: boolean;
  since?: Date;
  limit: number;
  staleDays: number;
};

type VendaZero = {
  id: string;
  amazonOrderId: string;
  sku: string;
  quantidade: number;
  valorBrutoCentavos: number | null;
  dataVenda: Date;
  marketplace: string | null;
  statusPedido: string;
};

type ProdutoLookup = {
  sku: string;
  amazonPrecoListagemCentavos: number | null;
};

type RecoveryAction =
  | {
      tipo: "RECOVER";
      fonte: "raw-modern" | "raw-report" | "sp-api" | "listing";
      venda: VendaZero;
      valorBrutoCentavos: number;
      taxasCentavos: number;
      fretesCentavos: number;
      quantidade: number;
    }
  | {
      tipo: "CANCEL";
      fonte: "raw-modern" | "sp-api";
      venda: VendaZero;
      motivo: string;
    }
  | {
      tipo: "SKIP";
      venda: VendaZero;
      motivo: string;
    };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const sinceIndex = argv.indexOf("--since");
  const limitIndex = argv.indexOf("--limit");

  return {
    apply: argv.includes("--apply"),
    since:
      sinceIndex >= 0 && argv[sinceIndex + 1]
        ? new Date(`${argv[sinceIndex + 1]}T00:00:00.000Z`)
        : undefined,
    limit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Math.max(1, Number(argv[limitIndex + 1]))
        : 250,
    staleDays: parsePositiveInt(readArg(argv, "--stale-days"), 2),
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

async function main() {
  const args = parseArgs();
  console.log(`Modo: ${args.apply ? "APPLY" : "DRY-RUN"}\n`);

  const alvos = await buscarAlvos(args);
  const alvosVenda = alvos.filter(
    (venda) =>
      !isVendaAmazonRemovalOrder({
        amazonOrderId: venda.amazonOrderId,
        marketplace: venda.marketplace,
      }),
  );

  const rawPorPedido = await carregarRawPorPedido(
    alvosVenda.map((venda) => venda.amazonOrderId),
  );
  const produtoPorSku = await carregarProdutoPorSku(
    alvosVenda.map((venda) => venda.sku),
  );
  const creds = await carregarCredenciaisSeDisponiveis();

  const actions: RecoveryAction[] = [];
  for (const venda of alvosVenda) {
    const deveConsultarApiPrimeiro = (venda.valorBrutoCentavos ?? 0) > 0;

    if (deveConsultarApiPrimeiro && creds) {
      const apiAction = await resolverPelaSpApi(venda, creds);
      if (apiAction) {
        actions.push(apiAction);
        continue;
      }
    }

    const raw = rawPorPedido.get(venda.amazonOrderId);
    const rawAction = raw ? resolverPeloRaw(venda, raw) : null;
    if (rawAction) {
      actions.push(rawAction);
      continue;
    }

    if (!deveConsultarApiPrimeiro && creds) {
      const apiAction = await resolverPelaSpApi(venda, creds);
      if (apiAction) {
        actions.push(apiAction);
        continue;
      }
    }

    const produto = produtoPorSku.get(venda.sku);
    const listingCentavos = produto?.amazonPrecoListagemCentavos ?? 0;
    if (listingCentavos > 0) {
      actions.push({
        tipo: "RECOVER",
        fonte: "listing",
        venda,
        valorBrutoCentavos: listingCentavos * venda.quantidade,
        taxasCentavos: 0,
        fretesCentavos: 0,
        quantidade: venda.quantidade,
      });
      continue;
    }

    actions.push({
      tipo: "SKIP",
      venda,
      motivo: creds
        ? "sem preco no raw, SP-API e listing"
        : "sem preco no raw/listing; SP-API indisponivel",
    });
  }

  imprimirResumo(actions);

  if (args.apply) {
    await aplicar(actions);
  }

  salvarRelatorio(actions, args.apply);
  await db.$disconnect();
}

async function buscarAlvos(args: Args): Promise<VendaZero[]> {
  const staleCutoff = new Date(
    Date.now() - args.staleDays * 24 * 60 * 60 * 1000,
  );

  return db.vendaAmazon.findMany({
    where: {
      AND: [
        { statusPedido: { in: [...STATUS_PEDIDO_PENDENTE, "UNKNOWN"] } },
        ...(args.since ? [{ dataVenda: { gte: args.since } }] : []),
        {
          OR: [
            { valorBrutoCentavos: null },
            { valorBrutoCentavos: { lte: 0 } },
            {
              AND: [
                { valorBrutoCentavos: { gt: 0 } },
                { dataVenda: { lt: staleCutoff } },
              ],
            },
          ],
        },
      ],
    },
    orderBy: { dataVenda: "asc" },
    take: args.limit,
    select: {
      id: true,
      amazonOrderId: true,
      sku: true,
      quantidade: true,
      valorBrutoCentavos: true,
      dataVenda: true,
      marketplace: true,
      statusPedido: true,
    },
  });
}

async function carregarRawPorPedido(orderIds: string[]) {
  const raws = await db.amazonOrderRaw.findMany({
    where: { amazonOrderId: { in: [...new Set(orderIds)] } },
    select: { amazonOrderId: true, payloadJson: true },
  });

  const mapa = new Map<string, unknown>();
  for (const raw of raws) {
    mapa.set(raw.amazonOrderId, parsePayloadJson(raw.payloadJson));
  }
  return mapa;
}

async function carregarProdutoPorSku(skus: string[]) {
  const produtos: ProdutoLookup[] = await db.produto.findMany({
    where: { sku: { in: [...new Set(skus)] } },
    select: { sku: true, amazonPrecoListagemCentavos: true },
  });
  return new Map(produtos.map((produto) => [produto.sku, produto]));
}

async function carregarCredenciaisSeDisponiveis(): Promise<SPAPICredentials | null> {
  const config = await getAmazonConfig();
  if (!isAmazonConfigured(config)) {
    console.warn("Credenciais Amazon indisponiveis; pulando SP-API.");
    return null;
  }
  return {
    clientId: config.amazon_client_id as string,
    clientSecret: config.amazon_client_secret as string,
    refreshToken: config.amazon_refresh_token as string,
    marketplaceId: config.amazon_marketplace_id as string,
    endpoint: config.amazon_endpoint || undefined,
  };
}

function resolverPeloRaw(
  venda: VendaZero,
  payload: unknown,
): RecoveryAction | null {
  const reportRow = findReportRow(payload, venda.sku);
  if (reportRow) {
    const valor = readCentavos(reportRow.itemPriceCentavos);
    if (valor > 0) {
      return {
        tipo: "RECOVER",
        fonte: "raw-report",
        venda,
        valorBrutoCentavos: valor,
        taxasCentavos: readCentavos(reportRow.itemTaxCentavos),
        fretesCentavos: readCentavos(reportRow.shippingPriceCentavos),
        quantidade: readQuantidade(reportRow.quantity, venda.quantidade),
      };
    }
  }

  const orderItems = findOrderItems(payload);
  const matching = orderItems.filter((item) => skuDoItemRaw(item) === venda.sku);
  const items = matching.length > 0 ? matching : orderItems;
  if (items.length === 0) return null;

  const todosZerados = items.every((item) => readQuantidade(item.quantityOrdered) <= 0);
  if (todosZerados) {
    return {
      tipo: "CANCEL",
      fonte: "raw-modern",
      venda,
      motivo: "payload raw com quantityOrdered=0",
    };
  }

  for (const item of items) {
    const quantidade = readQuantidade(item.quantityOrdered, venda.quantidade);
    const unitPrice = readCentavos(readPath(item, ["product", "price", "unitPrice"]));
    if (quantidade > 0 && unitPrice > 0) {
      return {
        tipo: "RECOVER",
        fonte: "raw-modern",
        venda,
        valorBrutoCentavos: unitPrice * quantidade,
        taxasCentavos: 0,
        fretesCentavos: 0,
        quantidade,
      };
    }
  }

  return null;
}

async function resolverPelaSpApi(
  venda: VendaZero,
  creds: SPAPICredentials,
): Promise<RecoveryAction | null> {
  await delay(2500);
  let items: SPOrderItemDetail[];
  try {
    items = await getOrderItems(creds, venda.amazonOrderId, { maxPages: 2 });
  } catch (error) {
    console.warn(
      `SP-API falhou para ${venda.amazonOrderId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
  const matching = items.filter((item) => item.SellerSKU === venda.sku);
  const candidates = matching.length > 0 ? matching : items;
  if (candidates.length === 0) return null;

  if (candidates.every((item) => item.QuantityOrdered <= 0)) {
    return {
      tipo: "CANCEL",
      fonte: "sp-api",
      venda,
      motivo: "getOrderItems com QuantityOrdered=0",
    };
  }

  for (const item of candidates) {
    const valor = moneyToCentavos(item.ItemPrice);
    if (valor > 0 && item.QuantityOrdered > 0) {
      return {
        tipo: "RECOVER",
        fonte: "sp-api",
        venda,
        valorBrutoCentavos: valor,
        taxasCentavos: moneyToCentavos(item.ItemTax),
        fretesCentavos: moneyToCentavos(item.ShippingPrice),
        quantidade: item.QuantityOrdered,
      };
    }
  }

  return null;
}

async function aplicar(actions: RecoveryAction[]) {
  for (const action of actions) {
    if (action.tipo === "RECOVER") {
      const quantidade = Math.max(1, action.quantidade);
      const liquido =
        action.valorBrutoCentavos - action.taxasCentavos - action.fretesCentavos;
      await db.vendaAmazon.update({
        where: { id: action.venda.id },
        data: {
          quantidade,
          valorBrutoCentavos: action.valorBrutoCentavos,
          precoUnitarioCentavos: Math.round(action.valorBrutoCentavos / quantidade),
          taxasCentavos: action.taxasCentavos,
          fretesCentavos: action.fretesCentavos,
          liquidoMarketplaceCentavos: liquido,
          precoOrigem:
            action.fonte === "listing" ? "listing" : "sp-api",
          ultimaSyncEm: new Date(),
        },
      });
      continue;
    }

    if (action.tipo === "CANCEL") {
      await db.vendaAmazon.update({
        where: { id: action.venda.id },
        data: {
          statusPedido: "Cancelled",
          ultimaSyncEm: new Date(),
        },
      });
    }
  }
}

function imprimirResumo(actions: RecoveryAction[]) {
  const recover = actions.filter((a) => a.tipo === "RECOVER");
  const cancel = actions.filter((a) => a.tipo === "CANCEL");
  const skip = actions.filter((a) => a.tipo === "SKIP");
  const total = recover.reduce(
    (acc, action) => acc + action.valorBrutoCentavos,
    0,
  );

  console.log(`RECOVER: ${recover.length} linha(s), R$ ${(total / 100).toFixed(2)}`);
  console.log(`CANCEL : ${cancel.length} linha(s)`);
  console.log(`SKIP   : ${skip.length} linha(s)\n`);

  for (const action of actions) {
    if (action.tipo === "RECOVER") {
      console.log(
        `RECOVER ${action.venda.amazonOrderId} ${action.venda.sku} ` +
          `${action.fonte} R$ ${(action.valorBrutoCentavos / 100).toFixed(2)}`,
      );
    } else if (action.tipo === "CANCEL") {
      console.log(
        `CANCEL  ${action.venda.amazonOrderId} ${action.venda.sku} ` +
          `${action.fonte} ${action.motivo}`,
      );
    } else {
      console.log(
        `SKIP    ${action.venda.amazonOrderId} ${action.venda.sku} ` +
          action.motivo,
      );
    }
  }
}

function salvarRelatorio(actions: RecoveryAction[], applied: boolean) {
  const dir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `recover-zero-pending-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ applied, generatedAt: new Date().toISOString(), actions }, null, 2),
  );
  console.log(`\nRelatorio salvo em ${file}`);
}

function parsePayloadJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let parsed: unknown = JSON.parse(value);
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  return parsed;
}

function findReportRow(payload: unknown, sku: string): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload.rows)) return null;
  return (
    payload.rows.find(
      (row): row is Record<string, unknown> =>
        isRecord(row) && String(row.sku ?? "").trim() === sku,
    ) ?? null
  );
}

function findOrderItems(payload: unknown): Array<Record<string, unknown>> {
  const items = readPath(payload, ["orderItems"]);
  if (!Array.isArray(items)) return [];
  return items.filter(isRecord);
}

function skuDoItemRaw(item: Record<string, unknown>): string | null {
  const productSku = readPath(item, ["product", "sellerSku"]);
  const sellerSku = item.sellerSku ?? item.SellerSKU;
  return typeof productSku === "string"
    ? productSku
    : typeof sellerSku === "string"
      ? sellerSku
      : null;
}

function moneyToCentavos(value: SPOrderItemDetail["ItemPrice"]): number {
  return readCentavos(value?.Amount);
}

function readCentavos(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return 0;
    const decimal =
      normalized.includes(",") && !normalized.includes(".")
        ? normalized.replace(".", "").replace(",", ".")
        : normalized.replace(/,/g, "");
    const parsed = Number(decimal.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  if (isRecord(value)) {
    return readCentavos(
      value.amount ??
        value.Amount ??
        value.value ??
        value.Value ??
        value.currencyAmount ??
        value.CurrencyAmount,
    );
  }
  return 0;
}

function readQuantidade(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function readPath(value: unknown, pathParts: string[]): unknown {
  let cursor = value;
  for (const part of pathParts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
