import { db } from "@/lib/db";
import {
  decryptConfigValue,
  encryptConfigValue,
  isSecretConfigKey,
} from "@/lib/crypto";
import {
  createProductReviewAndSellerFeedbackSolicitation,
  getInventorySummaries,
  listFinancialTransactions,
  getMarketplaceParticipations,
  getOrder,
  getSellerId,
  getOrders,
  getOrderItems,
  getSolicitationActionsForOrder,
  getCatalogItem,
  getProductOffers,
  getSettlementReports,
  getReportDocument,
  type SPFinanceTransaction,
  type SPAPICredentials,
  type SPOrder,
  type SPOrderItemDetail,
  fetchOrdersByIdsFromList,
} from "@/lib/amazon-sp-api";
import { gunzipSync } from "zlib";
import {
  agruparValoresFinanceirosVendaAmazon,
  type LinhaFinanceiraVendaAmazon,
} from "@/modules/amazon/finance-aggregation";
import {
  OrigemAmazonReviewSolicitation,
  OrigemMovimentacaoEstoque,
  StatusAmazonReviewSolicitation,
  StatusAmazonSync,
  StatusContaReceber,
  TipoAmazonSync,
  TipoMovimentacaoEstoque,
} from "@/modules/shared/domain";
import { agruparLinhasVendaAmazon } from "@/modules/vendas/agrupamento";
import {
  calcularPrecoUnitarioCentavos,
  valorBrutoDaVenda,
  valorBrutoFinanceiroPodeAtualizar,
} from "@/modules/vendas/valores";
import { addDays, subDays, subHours } from "date-fns";

// Chaves de configuração armazenadas em ConfiguracaoSistema.
export const AMAZON_CONFIG_KEYS = [
  "amazon_client_id",
  "amazon_client_secret",
  "amazon_refresh_token",
  "amazon_marketplace_id",
  "amazon_endpoint",
  "amazon_seller_id",
] as const;

// Chaves usadas pela automação diária de solicitação de reviews.
const REVIEWS_CONFIG_AUTOMACAO = "reviews_automation_active";
const REVIEWS_CONFIG_AUTOMACAO_LEGACY = "reviews_automacao_ativa";
const REVIEWS_CONFIG_ULTIMA = "reviews_ultima_execucao";
const REVIEWS_CONFIG_BACKFILL_START = "reviews_backfill_start_date";
const REVIEWS_CONFIG_DELAY_DAYS = "reviews_delay_days";
const REVIEWS_CONFIG_DAILY_BATCH_SIZE = "reviews_daily_batch_size";
const REVIEWS_DISCOVERY_CURSOR_KEY = "reviews_discovery_cursor";
const REVIEWS_DEFAULT_BACKFILL_START = "2026-04-02";
const REVIEWS_DEFAULT_DELAY_DAYS = 7;
const REVIEWS_DEFAULT_BATCH_SIZE = 30;

// Janela segura dentro das regras da Amazon:
// - Solicitations API aceita apenas entre ~5 e 30 dias após entrega.
// - Fila ativa considera pedidos criados nos ultimos 30 dias.
const REVIEWS_LOOKBACK_DIAS = 30;

// Batch conservador por execução (Vercel Hobby tem 10s de timeout).
// 8 pedidos × ~2.2s cada (check + send com 1.1s de delay entre elas) ≈ 17s no pior caso.
// Reduzimos para 5 por execução para ficar abaixo do limite.
const REVIEWS_BATCH_POR_EXECUCAO = 5;
const DEFAULT_MARKETPLACE_ID = "A2Q3Y263D00KWC";

// Helper para campos JSON: SQLite armazena como String?; em Postgres viraria Json.
// Mantemos a mesma forma de chamada (asJson(...)) para facilitar troca de provider.
function asJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}
const ORDERS_CURSOR_KEY = "amazon_orders_last_updated_after";
const BACKFILL_CURSOR_KEY = "amazon_backfill_orders_cursor";
const AMAZON_LOJA_ABERTA_EM = "2025-08-23T03:00:00.000Z";

export const AMAZON_REQUIRED_CONFIG_KEYS = [
  "amazon_client_id",
  "amazon_client_secret",
  "amazon_refresh_token",
  "amazon_marketplace_id",
] as const;

export type AmazonConfigKey = (typeof AMAZON_CONFIG_KEYS)[number];

type OrderMetadata = {
  asin?: string;
  sku?: string;
  orderCreatedAt?: Date;
  earliestDeliveryDate?: Date;
  latestDeliveryDate?: Date;
};

type VendaAmazonSyncResumo = {
  amazonOrderId: string;
  purchaseDate: string;
  lastUpdatedDate: string;
  asin?: string;
  sku?: string;
  quantityOrdered?: number;
  statusPedido?: string;
};

type SyncOrdersResult = {
  lidas: number;
  pedidosBrutos: number;
  criadas: number;
  atualizadas: number;
  ignoradas: number;
  pedidos: VendaAmazonSyncResumo[];
  rateLimited?: boolean;
  mensagem?: string;
};

type SyncOrdersInternalOptions = {
  diasAtras: number;
  startDate?: Date;
  endDate?: Date;
  orderIds?: string[];
  cursorKey?: string;
  tipo?: string;
  maxPages?: number;
  overlapMinutes?: number;
  dateFilter?: "created" | "lastUpdated";
};

export async function getAmazonConfig(): Promise<Record<string, string>> {
  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: [...AMAZON_CONFIG_KEYS] } },
  });
  const config: Record<string, string> = {};
  for (const r of registros) {
    // Decripta automaticamente valores marcados com prefixo `enc:`.
    config[r.chave] = decryptConfigValue(r.valor) ?? "";
  }

  config.amazon_client_id ||= process.env.AMAZON_LWA_CLIENT_ID ?? "";
  config.amazon_client_secret ||= process.env.AMAZON_LWA_CLIENT_SECRET ?? "";
  config.amazon_refresh_token ||= process.env.AMAZON_LWA_REFRESH_TOKEN ?? "";
  config.amazon_marketplace_id ||=
    process.env.AMAZON_MARKETPLACE_ID ?? DEFAULT_MARKETPLACE_ID;
  config.amazon_endpoint ||= process.env.AMAZON_SP_API_ENDPOINT ?? "";

  return config;
}

export function isAmazonConfigured(config: Record<string, string>) {
  return AMAZON_REQUIRED_CONFIG_KEYS.every((key) => !!config[key]);
}

export async function saveAmazonConfig(
  updates: Record<string, string>,
): Promise<void> {
  for (const [chave, valor] of Object.entries(updates)) {
    if (!AMAZON_CONFIG_KEYS.includes(chave as AmazonConfigKey)) continue;

    // A tela recebe valores mascarados no GET. Se o usuário salvar sem
    // redigitar um segredo, preservamos o valor real já armazenado.
    if (isSecretConfigKey(chave) && valor.includes("*")) continue;

    if (!valor) {
      await db.configuracaoSistema.deleteMany({ where: { chave } });
    } else {
      // Criptografa em repouso quando for campo sensível (secret, token, password).
      const armazenado = isSecretConfigKey(chave) ? encryptConfigValue(valor) : valor;
      await db.configuracaoSistema.upsert({
        where: { chave },
        create: { chave, valor: armazenado },
        update: { valor: armazenado },
      });
    }
  }

  // Após salvar, se as credenciais essenciais estiverem completas e ainda
  // não houver `amazon_seller_id`, resolve via SP-API e persiste. Falhas
  // (ex.: 403, rate limit) não devem quebrar o salvamento da config.
  try {
    const config = await getAmazonConfig();
    const creds = buildCredentials(config);
    if (creds && !config.amazon_seller_id) {
      const sellerId = await getSellerId(creds);
      if (sellerId) {
        await db.configuracaoSistema.upsert({
          where: { chave: "amazon_seller_id" },
          create: { chave: "amazon_seller_id", valor: sellerId },
          update: { valor: sellerId },
        });
      }
    }
  } catch (err) {
    console.warn(
      "[saveAmazonConfig] Falha ao resolver amazon_seller_id automaticamente:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function buildCredentials(
  config: Record<string, string>,
): SPAPICredentials | null {
  if (!isAmazonConfigured(config)) return null;

  return {
    clientId: config.amazon_client_id as string,
    clientSecret: config.amazon_client_secret as string,
    refreshToken: config.amazon_refresh_token as string,
    marketplaceId: config.amazon_marketplace_id as string,
    endpoint: config.amazon_endpoint || undefined,
  };
}

async function getCredentialsOrThrow(): Promise<SPAPICredentials> {
  const config = await getAmazonConfig();
  const creds = buildCredentials(config);

  if (!creds) {
    throw new Error("Configure as credenciais da Amazon SP-API antes de continuar.");
  }

  return creds;
}

async function createLog(
  tipo: string,
  status: string,
  mensagem?: string,
  detalhes?: unknown,
  registros = 0,
) {
  return db.amazonSyncLog.create({
    data: {
      tipo,
      status,
      mensagem: mensagem ?? null,
      detalhes: asJson(detalhes),
      registros,
    },
  });
}

async function getSystemConfig(chave: string): Promise<string | null> {
  const registro = await db.configuracaoSistema.findUnique({ where: { chave } });
  return registro?.valor ?? null;
}

async function setSystemConfig(chave: string, valor: string): Promise<void> {
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
}

export async function testConnection(): Promise<{ ok: boolean; mensagem: string }> {
  const config = await getAmazonConfig();
  const creds = buildCredentials(config);

  if (!creds) {
    return { ok: false, mensagem: "Credenciais incompletas. Configure LWA e marketplace." };
  }

  try {
    await getMarketplaceParticipations(creds);
    return {
      ok: true,
      mensagem: `Conexão SP-API bem-sucedida para marketplace ${creds.marketplaceId}.`,
    };
  } catch (e) {
    return {
      ok: false,
      mensagem: e instanceof Error ? e.message : "Erro desconhecido",
    };
  }
}

export async function syncOrders(
  diasAtras = 3,
  options: { maxPages?: number; since?: Date; orderIds?: string[] } = {},
): Promise<SyncOrdersResult> {
  const orderIds = normalizeOrderIds(options.orderIds);
  if (orderIds.length > 0) {
    return syncOrdersInternal({
      diasAtras,
      orderIds,
      maxPages: options.maxPages ?? 1,
      dateFilter: "lastUpdated",
    });
  }

  // Passagem 1 — createdAfter: descobre TODOS os pedidos (incluindo Pending)
  // criados no período, independente de quando foram atualizados.
  const createdSince = options.since ?? subDays(new Date(), diasAtras);
  const r1 = await syncOrdersInternal({
    diasAtras,
    startDate: createdSince,
    maxPages: options.maxPages ?? 1,
    dateFilter: "created",
  });

  // Passagem 2 — lastUpdatedAfter: captura mudanças de status em pedidos
  // mais antigos (ex: pedido de 5 dias atrás que acabou de ser enviado).
  // Usa janela fixa de 6h para não duplicar o custo de rate limit.
  // Se já estourou o rate limit na passagem 1, pula a 2.
  if (r1.rateLimited) return r1;

  const updatedSince = subHours(new Date(), 6);
  const r2 = await syncOrdersInternal({
    diasAtras,
    startDate: updatedSince,
    maxPages: 1,
    dateFilter: "lastUpdated",
  }).catch(() => null);

  if (!r2) return r1;

  return {
    lidas: r1.lidas + r2.lidas,
    pedidosBrutos: r1.pedidosBrutos + r2.pedidosBrutos,
    criadas: r1.criadas + r2.criadas,
    atualizadas: r1.atualizadas + r2.atualizadas,
    ignoradas: r1.ignoradas + r2.ignoradas,
    pedidos: [...r1.pedidos, ...r2.pedidos],
    rateLimited: r2.rateLimited,
    mensagem: r2.rateLimited ? r2.mensagem : r1.mensagem,
  };
}

export async function syncBackfillOrders(): Promise<
  SyncOrdersResult & {
    janela: { de: string; ate: string };
    completo: boolean;
  }
> {
  const inicioPadrao = new Date(AMAZON_LOJA_ABERTA_EM);
  const fim = subDays(new Date(), 2);
  const cursor = await getSystemConfig(BACKFILL_CURSOR_KEY);
  const inicio = cursor ? new Date(cursor) : inicioPadrao;
  const ate = new Date(Math.min(addDays(inicio, 14).getTime(), fim.getTime()));

  if (inicio >= fim) {
    return {
      lidas: 0,
      pedidosBrutos: 0,
      criadas: 0,
      atualizadas: 0,
      ignoradas: 0,
      pedidos: [],
      janela: { de: fim.toISOString(), ate: fim.toISOString() },
      completo: true,
    };
  }

  const resultado = await syncOrdersInternal({
    diasAtras: 730,
    startDate: inicio,
    endDate: ate,
    cursorKey: BACKFILL_CURSOR_KEY,
    tipo: TipoAmazonSync.BACKFILL,
    maxPages: undefined,
    overlapMinutes: 0,
  });

  await setSystemConfig(BACKFILL_CURSOR_KEY, ate.toISOString());

  return {
    ...resultado,
    janela: { de: inicio.toISOString(), ate: ate.toISOString() },
    completo: ate.getTime() >= fim.getTime(),
  };
}

export async function syncFinances(
  diasAtras = 14,
  options: { maxPages?: number } = {},
) {
  return syncFinancialEvents(
    diasAtras,
    TipoAmazonSync.FINANCES,
    false,
    options,
  );
}

export async function syncRefunds(
  diasAtras = 90,
  options: { maxPages?: number } = {},
) {
  return syncFinancialEvents(diasAtras, TipoAmazonSync.REFUNDS, true, options);
}

export async function syncInventory(): Promise<{
  sincronizados: number;
  ajustados: number;
  criados: number;
  divergencias: Array<{ sku: string; erp: number; amazon: number }>;
  naoCadastrados: Array<{ sku: string; asin: string | null; qtdAmazon: number }>;
  rateLimited?: boolean;
  mensagem?: string;
}> {
  const logId = (
    await createLog(TipoAmazonSync.INVENTORY, StatusAmazonSync.PROCESSANDO)
  ).id;

  const creds = await getCredentialsOrThrow();
  const divergencias: Array<{ sku: string; erp: number; amazon: number }> = [];
  const naoCadastrados: Array<{
    sku: string;
    asin: string | null;
    qtdAmazon: number;
  }> = [];
  let sincronizados = 0;
  let ajustados = 0;
  const criados = 0;

  try {
    const summaries = await getInventorySummaries(creds);

    for (const item of summaries) {
      const produto = await db.produto.findUnique({
        where: { sku: item.sellerSku },
      });

      const qtdAmazon =
        item.inventoryDetails?.fulfillableQuantity ?? item.totalQuantity;
      const reservado =
        item.inventoryDetails?.reservedQuantity?.totalReservedQuantity ?? 0;
      const inbound = item.inventoryDetails?.inboundWorkingQuantity ?? 0;

      if (!produto) {
        // SKU não cadastrado no inventário: ignorado aqui (auto-registro ocorre em syncOrdersInternal)
        naoCadastrados.push({
          sku: item.sellerSku,
          asin: item.asin ?? null,
          qtdAmazon,
        });
        continue;
      }

      if (produto.estoqueAtual !== qtdAmazon) {
        const diferenca = qtdAmazon - produto.estoqueAtual;
        divergencias.push({
          sku: item.sellerSku,
          erp: produto.estoqueAtual,
          amazon: qtdAmazon,
        });
        await db.movimentacaoEstoque.create({
          data: {
            produtoId: produto.id,
            tipo:
              diferenca >= 0
                ? TipoMovimentacaoEstoque.ENTRADA
                : TipoMovimentacaoEstoque.SAIDA,
            quantidade: Math.abs(diferenca),
            custoUnitario: produto.custoUnitario ?? null,
            origem: OrigemMovimentacaoEstoque.AJUSTE,
            referenciaId: logId,
            observacoes: "Ajuste automatico pela Amazon FBA Inventory API",
            dataMovimentacao: new Date(),
          },
        });
        ajustados++;
      }

      await db.produto.update({
        where: { id: produto.id },
        data: {
          asin: produto.asin ?? item.asin ?? null,
          estoqueAtual: qtdAmazon,
          amazonEstoqueDisponivel: qtdAmazon,
          amazonEstoqueReservado: reservado,
          amazonEstoqueInbound: inbound,
          amazonEstoqueTotal: item.totalQuantity,
          amazonUltimaSyncEm: new Date(),
        },
      });
      sincronizados++;
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.SUCESSO,
        mensagem: `${sincronizados} SKUs verificados, ${divergencias.length} divergências, ${naoCadastrados.length} nao cadastrados`,
        detalhes: asJson(
          divergencias.length > 0 || naoCadastrados.length > 0
            ? { divergencias, naoCadastrados }
            : null,
        ),
        registros: sincronizados,
      },
    });
  } catch (e) {
    if (isAmazonRateLimitError(e)) {
      const mensagem =
        "Amazon SP-API limitou a quota de inventario. A sincronizacao foi reagendada.";
      await db.amazonSyncLog.update({
        where: { id: logId },
        data: {
          status: StatusAmazonSync.ERRO,
          mensagem,
          detalhes: asJson({
            erro: e instanceof Error ? e.message : String(e),
          }),
        },
      });
      return {
        sincronizados,
        ajustados,
        criados,
        divergencias,
        naoCadastrados,
        rateLimited: true,
        mensagem,
      };
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: e instanceof Error ? e.message : "Erro desconhecido",
      },
    });
    throw e;
  }

  return { sincronizados, ajustados, criados, divergencias, naoCadastrados };
}

async function syncOrdersInternal(
  options: SyncOrdersInternalOptions,
): Promise<SyncOrdersResult> {
  const tipo = options.tipo ?? TipoAmazonSync.ORDERS;
  const logId = (await createLog(tipo, StatusAmazonSync.PROCESSANDO)).id;
  const creds = await getCredentialsOrThrow();
  const cursorKey = options.cursorKey ?? ORDERS_CURSOR_KEY;
  const overlapMinutes = options.overlapMinutes ?? 15;
  const orderIds = normalizeOrderIds(options.orderIds);

  let criadas = 0;
  let atualizadas = 0;
  let ignoradas = 0;
  let pedidosBrutos = 0;
  let maxCursorDate: Date | null = null;
  let itemsRateLimited = false;

  try {
    const cursor = await getSystemConfig(cursorKey);
    const cursorDate = cursor ? new Date(cursor) : null;
    const since =
      options.startDate ??
      (cursorDate && Number.isFinite(cursorDate.getTime())
        ? new Date(cursorDate.getTime() - overlapMinutes * 60_000)
        : subDays(new Date(), options.diasAtras));
    const orders =
      orderIds.length > 0
        ? await fetchOrdersById(creds, orderIds)
        : await getOrders(creds, since, 100, {
            maxPages: options.maxPages,
            before: options.endDate,
            dateFilter: options.dateFilter ?? "created",
          });
    const pedidos: VendaAmazonSyncResumo[] = [];
    pedidosBrutos = orders.filter((order) => getAmazonOrderId(order)).length;

    for (const order of orders) {
      await upsertAmazonOrderRaw(creds, order, { itensProcessados: false });
    }

    // Buscamos itens detalhados (com preço, taxa, frete) por pedido.
    // /orders/v0/orders/{id}/orderItems. Rate limit ORDERS_GET = 0.5 rps (2s cooldown).
    // Otimização: pedidos que já têm valor REAL da SP-API (precoOrigem = "sp-api")
    // e status correto no banco apenas recebem update de status — evita chamada
    // desnecessária. Pedidos com precoOrigem = "listing" (fallback) ou null
    // continuam refazendo getOrderItems até o valor real chegar.
    const todosOrderIds = orders.map(getAmazonOrderId).filter((id): id is string => !!id);
    const existentesPreCheck = await db.vendaAmazon.findMany({
      where: { amazonOrderId: { in: todosOrderIds } },
      select: {
        amazonOrderId: true,
        valorBrutoCentavos: true,
        statusPedido: true,
        precoOrigem: true,
      },
    });
    const pedidosComDadosCompletos = new Set(
      existentesPreCheck
        .filter(
          (e) =>
            e.precoOrigem === "sp-api" &&
            (e.valorBrutoCentavos ?? 0) > 0 &&
            e.statusPedido !== "UNKNOWN",
        )
        .map((e) => e.amazonOrderId),
    );

    const itemsPorOrderId = new Map<string, SPOrderItemDetail[]>();
    const pedidosSoPraStatusUpdate: Array<{ amazonOrderId: string; order: SPOrder }> = [];

    for (const order of orders) {
      const amazonOrderId = getAmazonOrderId(order);
      if (!amazonOrderId) continue;

      if (pedidosComDadosCompletos.has(amazonOrderId)) {
        // Pedido já tem preço e status: agenda status-only update, pula getOrderItems.
        pedidosSoPraStatusUpdate.push({ amazonOrderId, order });
        continue;
      }

      try {
        await new Promise((r) => setTimeout(r, 2500));
        const detalhes = await getOrderItems(creds, amazonOrderId);
        const fallback = detalhes.length > 0 ? detalhes : orderItemsFromOrderSummary(order);
        itemsPorOrderId.set(amazonOrderId, fallback);
      } catch (err) {
        if (isAmazonRateLimitError(err)) {
          // Quota de itens esgotada — processa o que já buscou, próximo ciclo continua.
          itemsRateLimited = true;
          break;
        }
        // erro pontual num pedido — segue o fluxo, marca vazio
        itemsPorOrderId.set(amazonOrderId, orderItemsFromOrderSummary(order));
      }
    }

    // Status-only: atualiza statusPedido para pedidos que pularam getOrderItems.
    // O v0 já retorna OrderStatus, então podemos atualizar sem chamar getOrderItems.
    for (const { amazonOrderId, order } of pedidosSoPraStatusUpdate) {
      const novoStatus = getOrderStatus(order, "UNKNOWN");
      if (novoStatus && novoStatus !== "UNKNOWN") {
        await db.vendaAmazon.updateMany({
          where: { amazonOrderId },
          data: { statusPedido: novoStatus, ultimaSyncEm: new Date() },
        });
        atualizadas++;
      } else {
        ignoradas++;
      }
    }

    const skus = [
      ...new Set(
        Array.from(itemsPorOrderId.values())
          .flat()
          .map((item) => item.SellerSKU)
          .filter((sku): sku is string => !!sku),
      ),
    ];
    const produtos = await db.produto.findMany({
      where: { sku: { in: skus } },
      select: {
        sku: true,
        asin: true,
        custoUnitario: true,
        amazonPrecoListagemCentavos: true,
      },
    });
    const produtosPorSku = new Map(produtos.map((produto) => [produto.sku, produto]));

    // Auto-registra SKUs novos que não existem no catálogo local.
    // Cria um registro mínimo; o usuário deve preencher o custoUnitario depois.
    const skusSemProduto = skus.filter((sku) => !produtosPorSku.has(sku));
    for (const sku of skusSemProduto) {
      let asin: string | null = null;
      let titulo: string | null = null;
      for (const items of itemsPorOrderId.values()) {
        const it = items.find((i) => i.SellerSKU === sku);
        if (it) {
          asin = it.ASIN ?? null;
          titulo = it.Title ?? null;
          break;
        }
      }
      try {
        const criado = await db.produto.upsert({
          where: { sku },
          create: {
            sku,
            nome: titulo || sku,
            asin,
            ativo: true,
            custoUnitario: null,
            estoqueAtual: 0,
            estoqueMinimo: 0,
            unidade: "un",
          },
          update: {},
          select: {
            sku: true,
            asin: true,
            custoUnitario: true,
            amazonPrecoListagemCentavos: true,
          },
        });
        produtosPorSku.set(sku, criado);
      } catch {
        const existente = await db.produto.findUnique({
          where: { sku },
          select: {
            sku: true,
            asin: true,
            custoUnitario: true,
            amazonPrecoListagemCentavos: true,
          },
        });
        if (existente) produtosPorSku.set(sku, existente);
      }
    }

    for (const order of orders) {
      const amazonOrderId = getAmazonOrderId(order);
      if (!amazonOrderId) {
        ignoradas++;
        continue;
      }

      const cursorReferenceDate =
        options.dateFilter === "lastUpdated"
          ? getOrderLastUpdatedTime(order)
          : getOrderCreatedTime(order);
      if (
        cursorReferenceDate &&
        (!maxCursorDate || cursorReferenceDate > maxCursorDate)
      ) {
        maxCursorDate = cursorReferenceDate;
      }

      const itensDetalhados = itemsPorOrderId.get(amazonOrderId) ?? [];
      await upsertAmazonOrderRaw(creds, order, {
        itensProcessados: itensDetalhados.some((item) => !!item.SellerSKU),
      });

      const itensComSku = itensDetalhados.filter((item) => !!item.SellerSKU);
      ignoradas += itensDetalhados.length - itensComSku.length;
      const itensAgrupados = agruparLinhasVendaAmazon(
        itensComSku.map((item) => {
          const valorBrutoCentavos = parseAmountCentavos(item.ItemPrice);
          const taxasCentavos =
            parseAmountCentavos(item.ItemTax) +
            parseAmountCentavos(item.ShippingTax);

          return {
            ...item,
            amazonOrderId,
            sku: item.SellerSKU as string,
            quantidade: Math.max(1, Number(item.QuantityOrdered || 1)),
            valorBrutoCentavos,
            fretesCentavos: parseAmountCentavos(item.ShippingPrice),
            taxasCentavos,
            liquidoMarketplaceCentavos: valorBrutoCentavos - taxasCentavos,
          };
        }),
      );

      for (const item of itensAgrupados) {
        const sku = item.sku;
        const produto = produtosPorSku.get(sku);
        // Liquido = bruto - taxas (ItemTax + ShippingTax). Frete em geral
        // é repassado pelo cliente, então não entra como dedução do líquido.
        const where = {
          amazonOrderId_sku: {
            amazonOrderId,
            sku,
          },
        };
        const existente = await db.vendaAmazon.findUnique({ where });
        const statusPedido = getOrderStatus(order, existente?.statusPedido ?? "UNKNOWN");
        const createdAt = getOrderCreatedTime(order) ?? new Date();
        const lastUpdatedAt = getOrderLastUpdatedTime(order);

        // Decide valorBruto + precoOrigem.
        // - ItemPrice da SP-API existe (>0) → usa real, marca "sp-api".
        // - Senão, cache do listing (Produto.amazonPrecoListagemCentavos) → "listing".
        // - Senão, mantém o que já existia no banco; ou zero.
        // - Existente com "sp-api" NUNCA é sobrescrito por "listing" (preserva real).
        let valorBrutoFinal = item.valorBrutoCentavos;
        let precoOrigemFinal: string | null = null;
        let taxasFinal = item.taxasCentavos;
        let fretesFinal = item.fretesCentavos;
        let liquidoFinal: number = item.liquidoMarketplaceCentavos;

        if (valorBrutoFinal > 0) {
          precoOrigemFinal = "sp-api";
        } else if (
          produto?.amazonPrecoListagemCentavos &&
          produto.amazonPrecoListagemCentavos > 0
        ) {
          valorBrutoFinal = produto.amazonPrecoListagemCentavos * item.quantidade;
          precoOrigemFinal = "listing";
          // Sem taxas/frete reais ainda; deixar 0 e recalcular liquido.
          taxasFinal = 0;
          fretesFinal = 0;
          liquidoFinal = valorBrutoFinal;
        } else if (existente?.valorBrutoCentavos && existente.valorBrutoCentavos > 0) {
          // Sem ItemPrice novo e sem listing — preserva o que já tinha.
          valorBrutoFinal = existente.valorBrutoCentavos;
          precoOrigemFinal = existente.precoOrigem ?? null;
          taxasFinal = existente.taxasCentavos ?? 0;
          fretesFinal = existente.fretesCentavos ?? 0;
          liquidoFinal = existente.liquidoMarketplaceCentavos ?? valorBrutoFinal - taxasFinal;
        }

        // Não regredir "sp-api" → "listing".
        if (existente?.precoOrigem === "sp-api" && precoOrigemFinal === "listing") {
          valorBrutoFinal = existente.valorBrutoCentavos ?? valorBrutoFinal;
          precoOrigemFinal = "sp-api";
          taxasFinal = existente.taxasCentavos ?? taxasFinal;
          fretesFinal = existente.fretesCentavos ?? fretesFinal;
          liquidoFinal =
            existente.liquidoMarketplaceCentavos ?? valorBrutoFinal - taxasFinal;
        }

        const data = {
          orderItemId: item.OrderItemId ?? null,
          asin: item.ASIN ?? produto?.asin ?? null,
          titulo: item.Title ?? null,
          quantidade: item.quantidade,
          precoUnitarioCentavos: item.precoUnitarioCentavos,
          valorBrutoCentavos: valorBrutoFinal,
          taxasCentavos: taxasFinal,
          fretesCentavos: fretesFinal,
          liquidoMarketplaceCentavos: liquidoFinal,
          marketplace:
            getOrderMarketplaceName(order) ??
            getOrderMarketplace(order, creds.marketplaceId),
          fulfillmentChannel: getOrderFulfillmentChannel(order),
          statusPedido,
          statusFinanceiro: existente?.statusFinanceiro ?? "PENDENTE",
          precoOrigem: precoOrigemFinal,
          dataVenda: createdAt,
          ultimaSyncEm: new Date(),
        };

        if (existente) {
          await db.vendaAmazon.update({
            where: { id: existente.id },
            data,
          });
          atualizadas++;
        } else {
          await db.vendaAmazon.create({
            data: {
              amazonOrderId,
              sku,
              ...data,
              custoUnitarioCentavos:
                produto?.custoUnitario && produto.custoUnitario > 0
                  ? produto.custoUnitario
                  : null,
            },
          });
          criadas++;
        }

        pedidos.push({
          amazonOrderId,
          purchaseDate: createdAt.toISOString(),
          lastUpdatedDate: lastUpdatedAt?.toISOString() ?? createdAt.toISOString(),
          asin: item.ASIN,
          sku,
          quantityOrdered: item.quantidade,
          statusPedido,
        });
      }
    }

    if (maxCursorDate && !options.endDate && !options.startDate && orderIds.length === 0) {
      await setSystemConfig(cursorKey, maxCursorDate.toISOString());
    }

    const mensagem = itemsRateLimited
      ? `${pedidos.length} itens sincronizados; pedidos brutos preservados e itens restantes aguardam nova janela por rate limit.`
      : `${pedidos.length} itens de pedido sincronizados pela Orders API.`;
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.SUCESSO,
        mensagem,
        detalhes: asJson({ pedidos: pedidos.slice(0, 20), pedidosBrutos }),
        registros: pedidos.length,
      },
    });

    return {
      lidas: pedidos.length,
      pedidosBrutos,
      criadas,
      atualizadas,
      ignoradas,
      pedidos,
      rateLimited: itemsRateLimited || undefined,
      mensagem: itemsRateLimited ? mensagem : undefined,
    };
  } catch (e) {
    if (isAmazonRateLimitError(e)) {
      const mensagem =
        "Amazon SP-API limitou a quota de pedidos. Tente novamente em alguns minutos.";
      await db.amazonSyncLog.update({
        where: { id: logId },
        data: {
          status: StatusAmazonSync.ERRO,
          mensagem,
          detalhes: asJson({
            erro: e instanceof Error ? e.message : String(e),
          }),
          registros: 0,
        },
      });
      return {
        lidas: 0,
        pedidosBrutos,
        criadas,
        atualizadas,
        ignoradas,
        pedidos: [],
        rateLimited: true,
        mensagem,
      };
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: e instanceof Error ? e.message : "Erro desconhecido",
      },
    });
    throw e;
  }
}

async function syncFinancialEvents(
  diasAtras: number,
  tipo: string,
  onlyRefunds: boolean,
  options: { maxPages?: number } = {},
) {
  const logId = (await createLog(tipo, StatusAmazonSync.PROCESSANDO)).id;
  const creds = await getCredentialsOrThrow();
  let vendasAtualizadas = 0;
  let reembolsosCriados = 0;
  let reembolsosAtualizados = 0;
  let ignorados = 0;
  type VendaFinanceira = {
    id: string;
    sku: string;
    quantidade: number;
    precoUnitarioCentavos: number;
    valorBrutoCentavos: number | null;
  };
  const vendasPorPedido = new Map<string, Promise<VendaFinanceira[]>>();
  const loadVendasPedido = (orderId: string) => {
    let promise = vendasPorPedido.get(orderId);
    if (!promise) {
      promise = db.vendaAmazon.findMany({
        where: { amazonOrderId: orderId },
        select: {
          id: true,
          sku: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          valorBrutoCentavos: true,
        },
      });
      vendasPorPedido.set(orderId, promise);
    }
    return promise;
  };
  const resolveSku = async (orderId: string, item: Record<string, unknown>) => {
    const sku = readDeepString(item, [
      "sku",
      "sellerSku",
      "SellerSKU",
      "sellerSKU",
      "merchantSku",
    ]);
    if (sku) return sku;

    const vendas = await loadVendasPedido(orderId);
    return vendas.length === 1 ? vendas[0]?.sku : undefined;
  };

  try {
    const transactions = await listFinancialTransactions(
      creds,
      subDays(new Date(), diasAtras),
      undefined,
      100,
      { maxPages: options.maxPages ?? 1 },
    );

    for (const transaction of transactions) {
      const kind = normalizeFinanceKind(
        transaction.transactionType ??
          readDeepString(transaction, [
            "transactionType",
            "type",
            "eventType",
            "financialEventType",
          ]),
      );
      const isRefund = kind.includes("refund") || kind.includes("reembolso");
      if (onlyRefunds && !isRefund) continue;

      const items = getFinanceItems(transaction);
      const linhasFinanceiras: LinhaFinanceiraVendaAmazon[] = [];
      for (const item of items) {
        const orderId = findOrderId(transaction, item);
        const sku = orderId ? await resolveSku(orderId, item) : undefined;
        if (!orderId || !sku) {
          ignorados++;
          continue;
        }

        if (isRefund) {
          const produto = await db.produto.findUnique({
            where: { sku },
            select: { id: true, asin: true },
          });
          const dataReembolso =
            parseDate(
              transaction.postedDate ??
                readDeepString(transaction, ["postedDate", "date", "postedAt"]),
            ) ?? new Date();
          const amount = Math.abs(
            extractAmountCentavos(item) || extractAmountCentavos(transaction),
          );
          const referenciaExterna =
            transaction.transactionId ??
            `${orderId}:${sku}:${dataReembolso.toISOString()}:refund`;
          const existente = await db.amazonReembolso.findUnique({
            where: { referenciaExterna },
          });
          // taxasReembolsadasCentavos: AmazonFees no top-level já inclui Commission + FBA fees.
          // Fallback para a heurística antiga se nada bater (compat Finance Events API legacy).
          const taxasRefundTop = findBreakdownAmount(item, "AmazonFees");
          const taxasRefundCentavos = Math.abs(
            taxasRefundTop || sumBreakdowns(item, "fee"),
          );
          const data = {
            amazonOrderId: orderId,
            orderItemId: readDeepString(item, ["orderItemId", "OrderItemId"]) ?? null,
            sku,
            asin:
              readDeepString(item, ["asin", "ASIN"]) ?? produto?.asin ?? null,
            titulo: readDeepString(item, ["title", "description", "itemName"]) ?? null,
            quantidade: Math.max(
              1,
              Math.abs(readDeepNumber(item, ["quantity", "quantityShipped"]) ?? 1),
            ),
            valorReembolsadoCentavos: amount,
            taxasReembolsadasCentavos: taxasRefundCentavos,
            dataReembolso,
            liquidacaoId:
              findSettlementId(transaction) ??
              readDeepString(transaction, ["settlementId", "settlement-id"]) ??
              null,
            marketplace: transaction.marketplaceId ?? creds.marketplaceId,
            statusFinanceiro:
              transaction.transactionStatus ??
              readDeepString(transaction, ["status"]) ??
              "REEMBOLSADO",
            produtoId: produto?.id ?? null,
          };

          if (existente) {
            await db.amazonReembolso.update({
              where: { id: existente.id },
              data,
            });
            reembolsosAtualizados++;
          } else {
            await db.amazonReembolso.create({
              data: {
                ...data,
                referenciaExterna,
              },
            });
            reembolsosCriados++;
          }

          await db.vendaAmazon.updateMany({
            where: { amazonOrderId: orderId, sku },
            data: {
              statusPedido: "REEMBOLSADO",
              statusFinanceiro: "REEMBOLSADO",
              ultimaSyncEm: new Date(),
            },
          });
          continue;
        }

        const liquidoMarketplaceCentavos = extractAmountCentavos(item);

        // Transactions API v2024: AmazonFees no top-level já inclui Commission + FBA + tax.
        // Frete pode aparecer como ShippingChargeback (cobrança ao vendedor) ou ShippingCharge.
        // Fallback para a busca recursiva antiga se a API estiver no shape legacy.
        const taxasTop = findBreakdownAmount(item, "AmazonFees");
        const taxasCentavos = Math.abs(taxasTop || sumBreakdowns(item, "fee"));
        const fretesTop = sumTopBreakdowns(item, [
          "ShippingChargeback",
          "ShippingCharge",
          "Shipping",
        ]);
        const fretesCentavos = Math.abs(fretesTop || sumBreakdowns(item, "shipping"));

        // valorBruto = ProductCharges (preço cheio antes de deduzir taxas Amazon).
        const valorBrutoCentavos = findBreakdownAmount(item, "ProductCharges");

        const settlementId =
          findSettlementId(transaction) ??
          readDeepString(transaction, ["settlementId", "settlement-id"]);
        const statusFinanceiro =
          transaction.transactionStatus ??
          readDeepString(transaction, ["status"]) ??
          "LIQUIDADO";

        linhasFinanceiras.push({
          amazonOrderId: orderId,
          sku,
          valorBrutoCentavos,
          taxasCentavos,
          fretesCentavos,
          liquidoMarketplaceCentavos,
          liquidacaoId: settlementId ?? null,
          statusFinanceiro,
        });
      }

      const linhasAgrupadas =
        agruparValoresFinanceirosVendaAmazon(linhasFinanceiras);
      for (const linha of linhasAgrupadas) {
        const vendasParaAtualizar = (await loadVendasPedido(
          linha.amazonOrderId,
        )).filter((venda) => venda.sku === linha.sku);
        if (vendasParaAtualizar.length === 0) {
          ignorados++;
          continue;
        }

        for (const venda of vendasParaAtualizar) {
          const atualizarBruto = valorBrutoFinanceiroPodeAtualizar({
            valorBrutoAtualCentavos: valorBrutoDaVenda(venda),
            quantidadeAtual: venda.quantidade,
            valorBrutoFinanceiroCentavos: linha.valorBrutoCentavos,
          });

          await db.vendaAmazon.update({
            where: { id: venda.id },
            data: {
              taxasCentavos: linha.taxasCentavos,
              fretesCentavos: linha.fretesCentavos,
              ...(atualizarBruto
                ? {
                    valorBrutoCentavos: linha.valorBrutoCentavos,
                    precoUnitarioCentavos: calcularPrecoUnitarioCentavos(
                      linha.valorBrutoCentavos,
                      venda.quantidade,
                    ),
                  }
                : {}),
              liquidoMarketplaceCentavos:
                linha.liquidoMarketplaceCentavos ?? undefined,
              liquidacaoId: linha.liquidacaoId ?? undefined,
              statusFinanceiro: linha.statusFinanceiro ?? "LIQUIDADO",
              ultimaSyncEm: new Date(),
            },
          });
          vendasAtualizadas++;
        }
      }
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.SUCESSO,
        mensagem: `${transactions.length} eventos financeiros lidos.`,
        detalhes: asJson({
          vendasAtualizadas,
          reembolsosCriados,
          reembolsosAtualizados,
          ignorados,
        }),
        registros: transactions.length,
      },
    });

    return {
      lidas: transactions.length,
      vendasAtualizadas,
      reembolsosCriados,
      reembolsosAtualizados,
      ignorados,
    };
  } catch (e) {
    if (isAmazonRateLimitError(e)) {
      const mensagem =
        "Amazon SP-API limitou a quota financeira. A sincronizacao foi reagendada.";
      await db.amazonSyncLog.update({
        where: { id: logId },
        data: {
          status: StatusAmazonSync.ERRO,
          mensagem,
          detalhes: asJson({
            erro: e instanceof Error ? e.message : String(e),
          }),
        },
      });
      return {
        lidas: 0,
        vendasAtualizadas,
        reembolsosCriados,
        reembolsosAtualizados,
        ignorados,
        rateLimited: true,
        mensagem,
      };
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: e instanceof Error ? e.message : "Erro desconhecido",
      },
    });
    throw e;
  }
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * Converte um campo da SP-API tipo {Amount?: string; CurrencyCode?: string}
 * em centavos (Int). Robusto a undefined/NaN.
 */
function parseAmountCentavos(v: { Amount?: string } | undefined | null): number {
  if (!v?.Amount) return 0;
  const n = Number(v.Amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function normalizeOrderIds(orderIds?: string[]): string[] {
  if (!Array.isArray(orderIds)) return [];
  return [
    ...new Set(
      orderIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id): id is string => id.length > 0),
    ),
  ];
}

async function fetchOrdersById(
  creds: SPAPICredentials,
  orderIds: string[],
): Promise<SPOrder[]> {
  const ids = normalizeOrderIds(orderIds);
  if (ids.length === 0) return [];
  // Usa o endpoint de listagem com filtro AmazonOrderIds — retorna OrderStatus completo.
  // getOrder (endpoint individual) não retorna OrderStatus, gerando status UNKNOWN.
  return fetchOrdersByIdsFromList(creds, ids);
}

function getAmazonOrderId(order: SPOrder): string | undefined {
  return readStringFromOrder(order, [
    "orderId",
    "OrderId",
    "amazonOrderId",
    "AmazonOrderId",
  ]);
}

function getOrderStatus(order: SPOrder, fallback = "UNKNOWN"): string {
  return (
    readStringFromOrder(order, [
      "orderStatus",
      "OrderStatus",
      "status",
      "orderState",
    ]) ?? fallback
  );
}

function getOrderCreatedTime(order: SPOrder): Date | null {
  return parseDate(
    readStringFromOrder(order, [
      "createdTime",
      "CreatedTime",
      "purchaseDate",
      "PurchaseDate",
      "orderDate",
      "createdAt",
    ]),
  );
}

function getOrderLastUpdatedTime(order: SPOrder): Date | null {
  return parseDate(
    readStringFromOrder(order, [
      "lastUpdatedTime",
      "LastUpdatedTime",
      "lastUpdateDate",
      "LastUpdateDate",
      "updatedAt",
    ]),
  );
}

function getOrderMarketplace(order: SPOrder, fallback?: string): string | null {
  return (
    order.salesChannel?.marketplaceId ??
    readStringFromOrder(order, ["marketplaceId", "MarketplaceId"]) ??
    fallback ??
    null
  );
}

function getOrderMarketplaceName(order: SPOrder): string | null {
  return (
    order.salesChannel?.marketplaceName ??
    readStringFromOrder(order, ["marketplaceName", "MarketplaceName"]) ??
    null
  );
}

function getOrderFulfillmentChannel(order: SPOrder): string | null {
  return (
    order.salesChannel?.channelName ??
    readStringFromOrder(order, [
      "fulfillmentChannel",
      "FulfillmentChannel",
      "fulfillmentChannelCode",
      "channelName",
    ]) ??
    null
  );
}

async function upsertAmazonOrderRaw(
  creds: SPAPICredentials,
  order: SPOrder,
  options: { itensProcessados?: boolean } = {},
) {
  const amazonOrderId = getAmazonOrderId(order);
  if (!amazonOrderId) return;

  const base = {
    statusPedido: getOrderStatus(order),
    createdTime: getOrderCreatedTime(order),
    lastUpdatedTime: getOrderLastUpdatedTime(order),
    marketplaceId: getOrderMarketplace(order, creds.marketplaceId),
    fulfillmentChannel: getOrderFulfillmentChannel(order),
    payloadJson: asJson(order) ?? "{}",
    ultimaSyncEm: new Date(),
  };

  await db.amazonOrderRaw.upsert({
    where: { amazonOrderId },
    create: {
      amazonOrderId,
      ...base,
      itensProcessados: Boolean(options.itensProcessados),
    },
    update: {
      ...base,
      ...(options.itensProcessados ? { itensProcessados: true } : {}),
    },
  });
}

function orderItemsFromOrderSummary(order: SPOrder): SPOrderItemDetail[] {
  const rawItems: unknown[] = Array.isArray(order.orderItems)
    ? order.orderItems
    : readDeepArray(order, ["orderItems", "OrderItems", "items"]);

  return rawItems
    .map((item, index) => {
      const record = isObjectRecord(item) ? item : {};
      const product = isObjectRecord(record.product) ? record.product : {};
      const sku =
        readStringFromRecord(record, ["SellerSKU", "sellerSku", "sku"]) ??
        readStringFromRecord(product, ["SellerSKU", "sellerSku", "sku"]);
      const asin =
        readStringFromRecord(record, ["ASIN", "asin"]) ??
        readStringFromRecord(product, ["ASIN", "asin"]);
      const quantity =
        readDeepNumber(item, ["QuantityOrdered", "quantityOrdered", "quantity"]) ??
        1;

      return {
        ASIN: asin,
        SellerSKU: sku,
        OrderItemId:
          readStringFromRecord(record, ["OrderItemId", "orderItemId"]) ??
          `${getAmazonOrderId(order) ?? "order"}:${sku ?? index}`,
        Title:
          readStringFromRecord(record, ["Title", "title"]) ??
          readStringFromRecord(product, ["Title", "title", "itemName"]),
        QuantityOrdered: Math.max(1, Number(quantity) || 1),
        ItemPrice: toSpMoney(product.price ?? record.price ?? record.ItemPrice),
        ShippingPrice: toSpMoney(record.ShippingPrice ?? record.shippingPrice),
        ItemTax: toSpMoney(record.ItemTax ?? record.itemTax),
        ShippingTax: toSpMoney(record.ShippingTax ?? record.shippingTax),
      };
    })
    .filter((item) => !!item.SellerSKU || !!item.ASIN);
}

function toSpMoney(
  value: unknown,
): { Amount?: string; CurrencyCode?: string } | undefined {
  if (value == null) return undefined;
  const centavos = extractAmountCentavos(value);
  if (!centavos) return undefined;
  const currency = isObjectRecord(value)
    ? readStringFromRecord(value, ["CurrencyCode", "currencyCode", "currency"])
    : undefined;
  return {
    Amount: (centavos / 100).toFixed(2),
    ...(currency ? { CurrencyCode: currency } : {}),
  };
}

function extractAmountCentavos(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
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
  if (isObjectRecord(value)) {
    const amount =
      value.amount ??
      value.Amount ??
      value.value ??
      value.Value ??
      value.totalAmount ??
      value.TotalAmount ??
      value.currencyAmount ??
      value.CurrencyAmount;
    if (amount !== value) return extractAmountCentavos(amount);
  }
  return 0;
}

function getFinanceItems(
  transaction: SPFinanceTransaction,
): Array<Record<string, unknown>> {
  const directItems = transaction.transactionItems;
  if (Array.isArray(directItems) && directItems.length > 0) return directItems;

  const embeddedItems = readDeepArray(transaction, [
    "items",
    "ItemList",
    "shipmentItems",
    "refundItems",
  ]);
  if (embeddedItems.length > 0) return embeddedItems;

  return [transaction];
}

function normalizeFinanceKind(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findOrderId(
  transaction: SPFinanceTransaction,
  item: Record<string, unknown>,
): string | undefined {
  const fromItem = readDeepString(item, [
    "amazonOrderId",
    "AmazonOrderId",
    "orderId",
    "OrderId",
  ]);
  if (fromItem) return fromItem;

  const fromTransaction = readDeepString(transaction, [
    "amazonOrderId",
    "AmazonOrderId",
    "orderId",
    "OrderId",
  ]);
  if (fromTransaction) return fromTransaction;

  const related = transaction.relatedIdentifiers?.find((identifier) => {
    const name = normalizeFinanceKind(identifier.relatedIdentifierName);
    return name.includes("order");
  });
  return related?.relatedIdentifierValue;
}

// Legado (Finances Events API antiga) — não recursivo agora pra evitar
// double-count com a Transactions API v2024 que tem breakdowns aninhados.
// Mantido como fallback se findBreakdownAmount não acha nada.
function sumBreakdowns(value: unknown, keyword: string): number {
  let total = 0;
  visitRecords(value, (record) => {
    const label = normalizeFinanceKind(
      readStringFromRecord(record, [
        "type",
        "breakdownType",
        "chargeType",
        "feeType",
        "name",
      ]),
    );
    if (!label.includes(keyword)) return;
    total += extractAmountCentavos(
      record.amount ??
        record.Amount ??
        record.value ??
        record.Value ??
        record.totalAmount ??
        record.breakdownAmount,
    );
  });
  return total;
}

// Transactions API v2024 retorna `breakdowns: [{breakdownType, breakdownAmount:{currencyAmount}, breakdowns?}]`.
// Esta busca olha SÓ o nível superior do array de breakdowns do item — evita double-count
// (AmazonFees já totaliza Commission + FBA fees nos sub-breakdowns).
function findBreakdownAmount(item: unknown, breakdownType: string): number {
  if (!isObjectRecord(item)) return 0;
  const breakdowns = item.breakdowns;
  if (!Array.isArray(breakdowns)) return 0;
  for (const b of breakdowns) {
    if (!isObjectRecord(b)) continue;
    const type = readStringFromRecord(b, [
      "breakdownType",
      "type",
      "chargeType",
      "feeType",
      "name",
    ]);
    if (type === breakdownType) {
      return extractAmountCentavos(
        b.breakdownAmount ?? b.amount ?? b.Amount ?? b.value ?? b.Value,
      );
    }
  }
  return 0;
}

// Soma top-level breakdowns que casam com QUALQUER um dos tipos passados.
function sumTopBreakdowns(item: unknown, types: string[]): number {
  let total = 0;
  for (const t of types) total += findBreakdownAmount(item, t);
  return total;
}

// Procura SETTLEMENT_ID em transaction.relatedIdentifiers (Transactions API v2024).
function findSettlementId(transaction: {
  relatedIdentifiers?: Array<{
    relatedIdentifierName?: string | null;
    relatedIdentifierValue?: string | null;
  }>;
}): string | undefined {
  const found = transaction.relatedIdentifiers?.find((id) => {
    const name = (id?.relatedIdentifierName ?? "").toUpperCase();
    return name === "SETTLEMENT_ID" || name === "SETTLEMENTID";
  });
  return found?.relatedIdentifierValue ?? undefined;
}

function readDeepString(value: unknown, keys: string[]): string | undefined {
  let found: string | undefined;
  visitRecords(value, (record) => {
    if (found) return;
    found = readStringFromRecord(record, keys);
  });
  return found;
}

function readDeepNumber(value: unknown, keys: string[]): number | undefined {
  let found: number | undefined;
  visitRecords(value, (record) => {
    if (found != null) return;
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        found = candidate;
        return;
      }
      if (typeof candidate === "string") {
        const parsed = Number(candidate.replace(",", "."));
        if (Number.isFinite(parsed)) {
          found = parsed;
          return;
        }
      }
    }
  });
  return found;
}

function readDeepArray(value: unknown, keys: string[]): Array<Record<string, unknown>> {
  let found: Array<Record<string, unknown>> = [];
  visitRecords(value, (record) => {
    if (found.length > 0) return;
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        found = candidate.filter(isObjectRecord);
        return;
      }
    }
  });
  return found;
}

function readStringFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readStringFromOrder(order: SPOrder, keys: string[]): string | undefined {
  if (isObjectRecord(order)) {
    const direct = readStringFromRecord(order, keys);
    if (direct) return direct;
  }
  return readDeepString(order, keys);
}

function visitRecords(
  value: unknown,
  visitor: (record: Record<string, unknown>) => void,
  depth = 0,
) {
  if (depth > 5) return;
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visitor, depth + 1);
    return;
  }
  if (!isObjectRecord(value)) return;
  visitor(value);
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      visitRecords(child, visitor, depth + 1);
    }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAmazonRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("QuotaExceeded") ||
    message.includes("429") ||
    message.toLowerCase().includes("quota") ||
    message.toLowerCase().includes("cooldown") ||
    message.toLowerCase().includes("rate limit")
  );
}

export async function getLogs(limit = 20) {
  return db.amazonSyncLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listReviewSolicitations(limit = 100) {
  return db.amazonReviewSolicitation.findMany({
    orderBy: [
      { sentAt: "desc" },
      { lastAttemptAt: "desc" },
      { checkedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: limit,
  });
}

export async function checkReviewSolicitation(
  amazonOrderId: string,
  metadata: OrderMetadata = {},
) {
  const creds = await getCredentialsOrThrow();
  const existing = await db.amazonReviewSolicitation.findUnique({
    where: { amazonOrderId },
  });
  if (
    existing?.status === StatusAmazonReviewSolicitation.ENVIADO ||
    existing?.status === StatusAmazonReviewSolicitation.JA_SOLICITADO ||
    existing?.status === StatusAmazonReviewSolicitation.EXPIRADO
  ) {
    return existing;
  }
  await ensureReviewRecord(creds, amazonOrderId, metadata);
  return checkReviewSolicitationWithCreds(creds, amazonOrderId, metadata);
}

async function ensureReviewRecord(
  creds: SPAPICredentials,
  amazonOrderId: string,
  metadata: OrderMetadata = {},
) {
  const config = await getReviewAutomationConfig();
  const schedule = buildReviewSchedule(metadata, config);
  const existing = await db.amazonReviewSolicitation.findUnique({
    where: { amazonOrderId },
  });

  if (existing) {
    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        marketplaceId: creds.marketplaceId,
        asin: metadata.asin ?? undefined,
        sku: metadata.sku ?? undefined,
        orderCreatedAt: metadata.orderCreatedAt ?? undefined,
        eligibleFrom: schedule.eligibleFrom,
        deliveryWindowStart: schedule.deliveryWindowStart,
        deliveryWindowEnd: schedule.deliveryWindowEnd,
      },
    });
  }

  return db.amazonReviewSolicitation.create({
    data: {
      amazonOrderId,
      marketplaceId: creds.marketplaceId,
      asin: metadata.asin ?? null,
      sku: metadata.sku ?? null,
      orderCreatedAt: metadata.orderCreatedAt ?? null,
      origem: OrigemAmazonReviewSolicitation.MANUAL,
      eligibleFrom: schedule.eligibleFrom,
      deliveryWindowStart: schedule.deliveryWindowStart,
      deliveryWindowEnd: schedule.deliveryWindowEnd,
      status: StatusAmazonReviewSolicitation.PENDENTE,
      qualificationReason: "CRIADO_MANUALMENTE",
      nextCheckAt: schedule.eligibleFrom > new Date() ? schedule.eligibleFrom : new Date(),
    },
  });
}

export async function sendReviewSolicitation(
  amazonOrderId: string,
  confirm: boolean,
) {
  if (!confirm) {
    throw new Error("Confirmacao obrigatoria para enviar a solicitacao oficial.");
  }

  const creds = await getCredentialsOrThrow();
  const existing = await db.amazonReviewSolicitation.findUnique({
    where: { amazonOrderId },
  });

  if (isResolvedReviewStatus(existing?.status)) {
    return existing;
  }

  await ensureReviewRecord(creds, amazonOrderId, {
    asin: existing?.asin ?? undefined,
    sku: existing?.sku ?? undefined,
    orderCreatedAt: existing?.orderCreatedAt ?? undefined,
  });

  const checked = await checkReviewSolicitationWithCreds(creds, amazonOrderId, {
    asin: existing?.asin ?? undefined,
    sku: existing?.sku ?? undefined,
    orderCreatedAt: existing?.orderCreatedAt ?? undefined,
  });

  if (checked.status !== StatusAmazonReviewSolicitation.ELEGIVEL) {
    return checked;
  }

  return sendReviewSolicitationWithCreds(creds, amazonOrderId);
}

export async function processEligibleReviewSolicitations(diasAtras = 30) {
  return runReviewSolicitationQueue({
    diasAtras,
    requireAutomationActive: false,
    logMessage: "Execucao manual de reviews",
  });
}

async function sendReviewSolicitationLegacy(
  amazonOrderId: string,
  confirm: boolean,
) {
  if (!confirm) {
    throw new Error("Confirmação obrigatória para enviar a solicitação oficial.");
  }

  const creds = await getCredentialsOrThrow();
  const existing = await db.amazonReviewSolicitation.findUnique({
    where: { amazonOrderId },
  });

  if (existing?.sentAt || existing?.status === StatusAmazonReviewSolicitation.ENVIADO) {
    throw new Error("Solicitação já enviada para este pedido.");
  }

  let record = existing;
  if (!record || record.status !== StatusAmazonReviewSolicitation.ELEGIVEL) {
    record = await checkReviewSolicitationWithCredsLegacy(creds, amazonOrderId, {
      asin: existing?.asin ?? undefined,
      sku: existing?.sku ?? undefined,
    });
  }

  if (record.status !== StatusAmazonReviewSolicitation.ELEGIVEL) {
    throw new Error("Pedido não elegível para solicitação oficial neste momento.");
  }

  try {
    const response = await createProductReviewAndSellerFeedbackSolicitation(
      creds,
      amazonOrderId,
    );

    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        status: StatusAmazonReviewSolicitation.ENVIADO,
        sentAt: new Date(),
        errorMessage: null,
        rawResponse: asJson(response),
      },
    });
  } catch (e) {
    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        status: StatusAmazonReviewSolicitation.ERRO,
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

async function processEligibleReviewSolicitationsLegacy(diasAtras = 30) {
  const logId = (
    await createLog(TipoAmazonSync.REVIEWS, StatusAmazonSync.PROCESSANDO)
  ).id;

  const creds = await getCredentialsOrThrow();

  let verificados = 0;
  let enviados = 0;
  let ignorados = 0;
  const erros: string[] = [];

  try {
    const orders = await getOrders(creds, subDays(new Date(), diasAtras), 20);

    for (const order of orders) {
      const metadata = getOrderMetadata(order);
      const existing = await db.amazonReviewSolicitation.findUnique({
        where: { amazonOrderId: order.orderId },
      });

      if (existing?.sentAt || existing?.status === StatusAmazonReviewSolicitation.ENVIADO) {
        ignorados++;
        continue;
      }

      await delay(1100);
      const checked = await checkReviewSolicitationWithCredsLegacy(
        creds,
        order.orderId,
        metadata,
      );
      verificados++;

      if (checked.status !== StatusAmazonReviewSolicitation.ELEGIVEL) {
        ignorados++;
        continue;
      }

      await delay(1100);
      const sent = await sendReviewSolicitationWithCredsLegacy(creds, order.orderId);
      if (sent.status === StatusAmazonReviewSolicitation.ENVIADO) enviados++;
      else erros.push(`${order.orderId}: ${sent.errorMessage ?? "erro ao enviar"}`);
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: erros.length ? StatusAmazonSync.ERRO : StatusAmazonSync.SUCESSO,
        mensagem: `${verificados} verificados, ${enviados} enviados, ${ignorados} ignorados`,
        detalhes: asJson(erros.length ? erros : null),
        registros: enviados,
      },
    });

    return { verificados, enviados, ignorados, erros };
  } catch (e) {
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: e instanceof Error ? e.message : "Erro desconhecido",
      },
    });
    throw e;
  }
}

async function checkReviewSolicitationWithCreds(
  creds: SPAPICredentials,
  amazonOrderId: string,
  metadata: OrderMetadata = {},
) {
  await ensureReviewRecord(creds, amazonOrderId, metadata);
  const checkedAt = new Date();
  const config = await getReviewAutomationConfig();
  const schedule = buildReviewSchedule(metadata, config);

  try {
    const result = await getSolicitationActionsForOrder(creds, amazonOrderId);
    const canRequest = result.canRequestReview;

    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        marketplaceId: creds.marketplaceId,
        status: canRequest
          ? StatusAmazonReviewSolicitation.ELEGIVEL
          : StatusAmazonReviewSolicitation.AGUARDANDO,
        asin: metadata.asin ?? undefined,
        sku: metadata.sku ?? undefined,
        orderCreatedAt: metadata.orderCreatedAt ?? undefined,
        eligibleFrom: schedule.eligibleFrom,
        deliveryWindowStart: schedule.deliveryWindowStart,
        deliveryWindowEnd: schedule.deliveryWindowEnd,
        checkedAt,
        lastAttemptAt: checkedAt,
        attempts: { increment: 1 },
        nextCheckAt: canRequest ? null : addDays(checkedAt, 1),
        qualificationReason: canRequest
          ? "ACAO_OFICIAL_DISPONIVEL"
          : "AINDA_NAO_DISPONIVEL",
        resolvedReason: null,
        lastCheckedAction: canRequest ? "productReviewAndSellerFeedback" : null,
        errorMessage: null,
        rawResponse: asJson(result.response),
      },
    });
  } catch (e) {
    if (isAmazonRateLimitError(e)) {
      return db.amazonReviewSolicitation.update({
        where: { amazonOrderId },
        data: {
          status: StatusAmazonReviewSolicitation.AGUARDANDO,
          checkedAt,
          lastAttemptAt: checkedAt,
          attempts: { increment: 1 },
          nextCheckAt: new Date(checkedAt.getTime() + 30 * 60_000),
          qualificationReason: "QUOTA_AMAZON_COOLDOWN",
          errorMessage: errorToMessage(e),
          rawResponse: asJson({ message: errorToMessage(e) }),
        },
      });
    }

    return markReviewTechnicalError(
      amazonOrderId,
      checkedAt,
      errorToMessage(e),
    );
  }
}

async function sendReviewSolicitationWithCreds(
  creds: SPAPICredentials,
  amazonOrderId: string,
) {
  const attemptedAt = new Date();

  try {
    const response = await createProductReviewAndSellerFeedbackSolicitation(
      creds,
      amazonOrderId,
    );

    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        marketplaceId: creds.marketplaceId,
        status: StatusAmazonReviewSolicitation.ENVIADO,
        sentAt: attemptedAt,
        lastAttemptAt: attemptedAt,
        attempts: { increment: 1 },
        nextCheckAt: null,
        resolvedReason: "ENVIADO_PELA_API",
        qualificationReason: "ACAO_OFICIAL_DISPONIVEL",
        lastCheckedAction: "productReviewAndSellerFeedback",
        errorMessage: null,
        rawResponse: asJson(response),
      },
    });
  } catch (e) {
    const message = errorToMessage(e);
    if (isAmazonRateLimitError(e)) {
      return db.amazonReviewSolicitation.update({
        where: { amazonOrderId },
        data: {
          marketplaceId: creds.marketplaceId,
          status: StatusAmazonReviewSolicitation.AGUARDANDO,
          nextCheckAt: new Date(attemptedAt.getTime() + 30 * 60_000),
          qualificationReason: "QUOTA_AMAZON_COOLDOWN",
          lastAttemptAt: attemptedAt,
          attempts: { increment: 1 },
          errorMessage: message,
          rawResponse: asJson({ message }),
        },
      });
    }

    if (isAlreadySolicitedError(message)) {
      return db.amazonReviewSolicitation.update({
        where: { amazonOrderId },
        data: {
          marketplaceId: creds.marketplaceId,
          status: StatusAmazonReviewSolicitation.JA_SOLICITADO,
          nextCheckAt: null,
          resolvedReason: "AMAZON_JA_SOLICITADO",
          lastAttemptAt: attemptedAt,
          attempts: { increment: 1 },
          errorMessage: null,
          rawResponse: asJson({ message }),
        },
      });
    }

    if (isNotYetSolicitableError(message)) {
      return db.amazonReviewSolicitation.update({
        where: { amazonOrderId },
        data: {
          marketplaceId: creds.marketplaceId,
          status: StatusAmazonReviewSolicitation.AGUARDANDO,
          nextCheckAt: addDays(attemptedAt, 1),
          qualificationReason: "AINDA_NAO_DISPONIVEL",
          lastAttemptAt: attemptedAt,
          attempts: { increment: 1 },
          errorMessage: message,
          rawResponse: asJson({ message }),
        },
      });
    }

    return markReviewTechnicalError(amazonOrderId, attemptedAt, message);
  }
}

async function checkReviewSolicitationWithCredsLegacy(
  creds: SPAPICredentials,
  amazonOrderId: string,
  metadata: OrderMetadata = {},
) {
  try {
    const result = await getSolicitationActionsForOrder(creds, amazonOrderId);
    const status = result.canRequestReview
      ? StatusAmazonReviewSolicitation.ELEGIVEL
      : StatusAmazonReviewSolicitation.NAO_ELEGIVEL;

    return db.amazonReviewSolicitation.upsert({
      where: { amazonOrderId },
      create: {
        amazonOrderId,
        marketplaceId: creds.marketplaceId,
        status,
        asin: metadata.asin ?? null,
        sku: metadata.sku ?? null,
        checkedAt: new Date(),
        rawResponse: asJson(result.response),
      },
      update: {
        marketplaceId: creds.marketplaceId,
        status,
        asin: metadata.asin ?? undefined,
        sku: metadata.sku ?? undefined,
        checkedAt: new Date(),
        errorMessage: null,
        rawResponse: asJson(result.response),
      },
    });
  } catch (e) {
    return db.amazonReviewSolicitation.upsert({
      where: { amazonOrderId },
      create: {
        amazonOrderId,
        marketplaceId: creds.marketplaceId,
        status: StatusAmazonReviewSolicitation.ERRO,
        asin: metadata.asin ?? null,
        sku: metadata.sku ?? null,
        checkedAt: new Date(),
        errorMessage: e instanceof Error ? e.message : String(e),
      },
      update: {
        status: StatusAmazonReviewSolicitation.ERRO,
        checkedAt: new Date(),
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

async function sendReviewSolicitationWithCredsLegacy(
  creds: SPAPICredentials,
  amazonOrderId: string,
) {
  try {
    const response = await createProductReviewAndSellerFeedbackSolicitation(
      creds,
      amazonOrderId,
    );

    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        status: StatusAmazonReviewSolicitation.ENVIADO,
        sentAt: new Date(),
        errorMessage: null,
        rawResponse: asJson(response),
      },
    });
  } catch (e) {
    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        status: StatusAmazonReviewSolicitation.ERRO,
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

function getOrderMetadata(order: SPOrder): OrderMetadata {
  const firstItem = order.orderItems?.[0];
  return {
    asin: firstItem?.product?.asin,
    sku: firstItem?.product?.sellerSku,
    orderCreatedAt: parseDate(order.createdTime) ?? undefined,
    earliestDeliveryDate:
      parseDate(
        order.earliestDeliveryDate ??
          order.EarliestDeliveryDate ??
          readDeepString(order, ["earliestDeliveryDate", "EarliestDeliveryDate"]),
      ) ?? undefined,
    latestDeliveryDate:
      parseDate(
        order.latestDeliveryDate ??
          order.LatestDeliveryDate ??
          readDeepString(order, ["latestDeliveryDate", "LatestDeliveryDate"]),
      ) ?? undefined,
  };
}

function getOrderSkus(order: SPOrder): string[] {
  return [
    ...new Set(
      (order.orderItems ?? [])
        .map((item) => item.product?.sellerSku)
        .filter((sku): sku is string => !!sku),
    ),
  ];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Automação de reviews ────────────────────────────────────────────────────

export type ReviewAutomationConfig = {
  automacaoAtiva: boolean;
  ultimaExecucao: Date | null;
  backfillStartDate: string;
  delayDays: number;
  dailyBatchSize: number;
};

export async function getReviewAutomationConfig(): Promise<ReviewAutomationConfig> {
  const registros = await db.configuracaoSistema.findMany({
    where: {
      chave: {
        in: [
          REVIEWS_CONFIG_AUTOMACAO,
          REVIEWS_CONFIG_AUTOMACAO_LEGACY,
          REVIEWS_CONFIG_ULTIMA,
          REVIEWS_CONFIG_BACKFILL_START,
          REVIEWS_CONFIG_DELAY_DAYS,
          REVIEWS_CONFIG_DAILY_BATCH_SIZE,
        ],
      },
    },
  });
  const mapa = new Map(registros.map((r) => [r.chave, r.valor]));

  const automacaoAtiva =
    (mapa.get(REVIEWS_CONFIG_AUTOMACAO) ??
      mapa.get(REVIEWS_CONFIG_AUTOMACAO_LEGACY) ??
      "true") === "true";
  const ultimaStr = mapa.get(REVIEWS_CONFIG_ULTIMA);
  const ultimaExecucao = ultimaStr ? new Date(ultimaStr) : null;
  const backfillStartDate =
    mapa.get(REVIEWS_CONFIG_BACKFILL_START) ?? REVIEWS_DEFAULT_BACKFILL_START;
  const delayDays = parsePositiveInt(
    mapa.get(REVIEWS_CONFIG_DELAY_DAYS),
    REVIEWS_DEFAULT_DELAY_DAYS,
  );
  const dailyBatchSize = parsePositiveInt(
    mapa.get(REVIEWS_CONFIG_DAILY_BATCH_SIZE),
    REVIEWS_DEFAULT_BATCH_SIZE,
  );

  return {
    automacaoAtiva,
    ultimaExecucao,
    backfillStartDate,
    delayDays,
    dailyBatchSize,
  };
}

export async function setReviewAutomationActive(ativo: boolean) {
  await Promise.all([
    db.configuracaoSistema.upsert({
      where: { chave: REVIEWS_CONFIG_AUTOMACAO },
      create: {
        chave: REVIEWS_CONFIG_AUTOMACAO,
        valor: ativo ? "true" : "false",
      },
      update: { valor: ativo ? "true" : "false" },
    }),
    db.configuracaoSistema.upsert({
      where: { chave: REVIEWS_CONFIG_AUTOMACAO_LEGACY },
      create: {
        chave: REVIEWS_CONFIG_AUTOMACAO_LEGACY,
        valor: ativo ? "true" : "false",
      },
      update: { valor: ativo ? "true" : "false" },
    }),
  ]);
  // Invalida cache do scheduler para o toggle reagir em até 1 loop em vez de 30s.
  const { invalidateReviewToggleCache } = await import("@/modules/amazon/jobs");
  invalidateReviewToggleCache();
  return getReviewAutomationConfig();
}

export async function setReviewAutomationSettings(updates: {
  automacaoAtiva?: boolean;
  backfillStartDate?: string;
  delayDays?: number;
  dailyBatchSize?: number;
}) {
  const writes: Array<Promise<unknown>> = [];

  if (typeof updates.automacaoAtiva === "boolean") {
    writes.push(setReviewAutomationActive(updates.automacaoAtiva));
  }

  if (updates.backfillStartDate) {
    const parsed = parseConfigDate(updates.backfillStartDate);
    writes.push(
      setSystemConfig(
        REVIEWS_CONFIG_BACKFILL_START,
        parsed.toISOString().slice(0, 10),
      ),
    );
  }

  if (updates.delayDays != null) {
    writes.push(
      setSystemConfig(
        REVIEWS_CONFIG_DELAY_DAYS,
        String(Math.max(1, Math.floor(updates.delayDays))),
      ),
    );
  }

  if (updates.dailyBatchSize != null) {
    writes.push(
      setSystemConfig(
        REVIEWS_CONFIG_DAILY_BATCH_SIZE,
        String(Math.max(1, Math.floor(updates.dailyBatchSize))),
      ),
    );
  }

  await Promise.all(writes);
  return getReviewAutomationConfig();
}

async function markAutomationRun(em: Date) {
  await db.configuracaoSistema.upsert({
    where: { chave: REVIEWS_CONFIG_ULTIMA },
    create: { chave: REVIEWS_CONFIG_ULTIMA, valor: em.toISOString() },
    update: { valor: em.toISOString() },
  });
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseConfigDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date("2026-04-02T00:00:00.000Z");
}

function maxDate(...dates: Array<Date | null | undefined>) {
  const valid = dates.filter((date): date is Date => !!date);
  if (valid.length === 0) return null;
  return new Date(Math.max(...valid.map((date) => date.getTime())));
}

function buildReviewSchedule(
  metadata: OrderMetadata,
  config: ReviewAutomationConfig,
) {
  const createdMaturity = metadata.orderCreatedAt
    ? addDays(metadata.orderCreatedAt, config.delayDays)
    : null;
  const deliveryWindowStart = metadata.earliestDeliveryDate
    ? addDays(metadata.earliestDeliveryDate, 5)
    : null;
  const deliveryWindowEnd = metadata.latestDeliveryDate
    ? addDays(metadata.latestDeliveryDate, 30)
    : null;
  const eligibleFrom = deliveryWindowStart ?? createdMaturity ?? new Date();

  return {
    eligibleFrom,
    deliveryWindowStart,
    deliveryWindowEnd,
  };
}

const REVIEW_RESOLVED_STATUSES = [
  StatusAmazonReviewSolicitation.ENVIADO,
  StatusAmazonReviewSolicitation.JA_SOLICITADO,
  StatusAmazonReviewSolicitation.EXPIRADO,
] as const;

type ReviewAutomationResult = {
  executada: boolean;
  motivo?: string;
  pedidos30d: number;
  naFila: number;
  tentadosHoje: number;
  enviadosHoje: number;
  jaSolicitados: number;
  adiadosAmanha: number;
  expirados: number;
  errosReais: number;
  verificados: number;
  enviados: number;
  ignorados: number;
  erros: string[];
};

type ReviewQueueRecord = {
  id: string;
  amazonOrderId: string;
  marketplaceId: string;
  status: string;
  origem: string;
  asin: string | null;
  sku: string | null;
  orderCreatedAt: Date | null;
  eligibleFrom: Date | null;
  deliveryWindowStart: Date | null;
  deliveryWindowEnd: Date | null;
  nextCheckAt: Date | null;
  attempts: number;
  lastAttemptAt: Date | null;
  qualificationReason: string | null;
  resolvedReason: string | null;
  lastCheckedAction: string | null;
  checkedAt: Date | null;
  sentAt: Date | null;
  errorMessage: string | null;
  rawResponse: unknown;
  createdAt: Date;
  updatedAt: Date;
};

async function runReviewSolicitationQueue({
  diasAtras,
  requireAutomationActive,
  logMessage,
}: {
  diasAtras: number;
  requireAutomationActive: boolean;
  logMessage: string;
}): Promise<ReviewAutomationResult> {
  const reviewConfig = await getReviewAutomationConfig();
  if (requireAutomationActive) {
    if (!reviewConfig.automacaoAtiva) {
      return emptyReviewAutomationResult("Automacao desativada.");
    }
  }

  const creds = await getCredentialsOrThrow();
  const logId = (
    await createLog(TipoAmazonSync.REVIEWS, StatusAmazonSync.PROCESSANDO, logMessage)
  ).id;
  const now = new Date();
  const backfillStart = parseConfigDate(reviewConfig.backfillStartDate);
  const cutoff = maxDate(subDays(now, diasAtras), backfillStart) ?? backfillStart;
  const erros: string[] = [];

  let pedidos30d = 0;
  let tentadosHoje = 0;
  let enviadosHoje = 0;
  let jaSolicitados = 0;
  let adiadosAmanha = 0;
  let errosReais = 0;
  let descobertaRateLimited = false;

  try {
    const expirados = await expireOldReviewQueue(subDays(now, 45), now);
    const descoberta = await enqueueRecentReviewOrders(
      creds,
      now,
      cutoff,
      reviewConfig,
      OrigemAmazonReviewSolicitation.DAILY,
    );
    pedidos30d = descoberta.pedidos30d;
    descobertaRateLimited = descoberta.rateLimited;
    const queue = await getDueReviewQueue(cutoff, now, reviewConfig.dailyBatchSize);
    const pausedSkus = await getPausedReviewSkus();

    for (const record of queue) {
      const result = await processReviewQueueRecord(creds, record, pausedSkus, now);
      if (result.tentado) tentadosHoje += 1;
      if (result.enviado) enviadosHoje += 1;
      if (result.jaSolicitado) jaSolicitados += 1;
      if (result.adiado) adiadosAmanha += 1;
      if (result.erro) {
        errosReais += 1;
        erros.push(result.erro);
      }
    }

    const naFila = await countReviewQueue(cutoff);
    await markAutomationRun(new Date());
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: erros.length ? StatusAmazonSync.ERRO : StatusAmazonSync.SUCESSO,
        mensagem:
          `Reviews: ${pedidos30d} pedidos 30d, ${tentadosHoje} tentados, ` +
          `${enviadosHoje} enviados, ${adiadosAmanha} adiados`,
        detalhes: asJson({
          pedidos30d,
          naFila,
          tentadosHoje,
          enviadosHoje,
          jaSolicitados,
          adiadosAmanha,
          expirados,
          descobertaRateLimited,
          erros,
        }),
        registros: enviadosHoje,
      },
    });

    return {
      executada: true,
      pedidos30d,
      naFila,
      tentadosHoje,
      enviadosHoje,
      jaSolicitados,
      adiadosAmanha,
      expirados,
      errosReais,
      verificados: tentadosHoje,
      enviados: enviadosHoje,
      ignorados: jaSolicitados + adiadosAmanha + expirados,
      erros,
    };
  } catch (e) {
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: errorToMessage(e),
      },
    });
    throw e;
  }
}

function emptyReviewAutomationResult(motivo: string): ReviewAutomationResult {
  return {
    executada: false,
    motivo,
    pedidos30d: 0,
    naFila: 0,
    tentadosHoje: 0,
    enviadosHoje: 0,
    jaSolicitados: 0,
    adiadosAmanha: 0,
    expirados: 0,
    errosReais: 0,
    verificados: 0,
    enviados: 0,
    ignorados: 0,
    erros: [],
  };
}

async function enqueueRecentReviewOrders(
  creds: SPAPICredentials,
  now: Date,
  cutoff: Date,
  config: ReviewAutomationConfig,
  origem: OrigemAmazonReviewSolicitation = OrigemAmazonReviewSolicitation.DAILY,
) {
  let orders: SPOrder[] = [];
  try {
    orders = await getOrders(creds, cutoff, 20, {
      maxPages: 1,
      dateFilter: "created",
    });
  } catch (e) {
    if (isAmazonRateLimitError(e)) {
      return { pedidos30d: 0, rateLimited: true, maxOrderCreatedAt: null };
    }
    throw e;
  }

  const pausedSkus = await getPausedReviewSkus();
  let pedidos30d = 0;
  let maxOrderCreatedAt: Date | null = null;

  for (const order of orders) {
    if (!order.orderId) continue;

    const orderCreatedAt = parseDate(order.createdTime);
    if (!orderCreatedAt || orderCreatedAt < cutoff) continue;
    if (!maxOrderCreatedAt || orderCreatedAt > maxOrderCreatedAt) {
      maxOrderCreatedAt = orderCreatedAt;
    }

    pedidos30d += 1;
    const metadata = getOrderMetadata(order);
    const schedule = buildReviewSchedule(
      {
        ...metadata,
        orderCreatedAt,
      },
      config,
    );
    const skus = getOrderSkus(order);
    const skuPausado = skus.some((sku) => pausedSkus.has(sku));
    const expirado =
      schedule.deliveryWindowEnd != null && schedule.deliveryWindowEnd < now;
    const nextCheckAt = expirado
      ? null
      : skuPausado
        ? addDays(now, 1)
        : schedule.eligibleFrom > now
          ? schedule.eligibleFrom
          : now;
    await upsertReviewQueueOrder(
      creds,
      order.orderId,
      {
        ...metadata,
        orderCreatedAt,
      },
      {
        origem,
        eligibleFrom: schedule.eligibleFrom,
        deliveryWindowStart: schedule.deliveryWindowStart,
        deliveryWindowEnd: schedule.deliveryWindowEnd,
        status: expirado
          ? StatusAmazonReviewSolicitation.EXPIRADO
          : skuPausado
          ? StatusAmazonReviewSolicitation.AGUARDANDO
          : StatusAmazonReviewSolicitation.PENDENTE,
        nextCheckAt,
        qualificationReason: expirado
          ? "FORA_DA_JANELA_OFICIAL"
          : skuPausado
            ? "SKU_PAUSADO"
            : schedule.eligibleFrom > now
              ? "AGUARDANDO_MATURIDADE_7_DIAS"
              : "PEDIDO_NA_FILA",
      },
    );
  }

  return { pedidos30d, rateLimited: false, maxOrderCreatedAt };
}

async function upsertReviewQueueOrder(
  creds: SPAPICredentials,
  amazonOrderId: string,
  metadata: OrderMetadata,
  queue: {
    origem: OrigemAmazonReviewSolicitation;
    eligibleFrom: Date;
    deliveryWindowStart: Date | null;
    deliveryWindowEnd: Date | null;
    status: string;
    nextCheckAt: Date | null;
    qualificationReason: string;
  },
) {
  const existing = await db.amazonReviewSolicitation.findUnique({
    where: { amazonOrderId },
  });

  if (existing && isResolvedReviewStatus(existing.status)) {
    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        marketplaceId: creds.marketplaceId,
        asin: metadata.asin ?? undefined,
        sku: metadata.sku ?? undefined,
        orderCreatedAt: metadata.orderCreatedAt ?? undefined,
        eligibleFrom: queue.eligibleFrom,
        deliveryWindowStart: queue.deliveryWindowStart,
        deliveryWindowEnd: queue.deliveryWindowEnd,
      },
    });
  }

  if (existing) {
    const keepFutureCheck =
      existing.nextCheckAt != null &&
      queue.nextCheckAt != null &&
      existing.nextCheckAt > queue.nextCheckAt;
    return db.amazonReviewSolicitation.update({
      where: { amazonOrderId },
      data: {
        marketplaceId: creds.marketplaceId,
        asin: metadata.asin ?? undefined,
        sku: metadata.sku ?? undefined,
        orderCreatedAt: metadata.orderCreatedAt ?? undefined,
        origem: existing.origem ?? queue.origem,
        eligibleFrom: queue.eligibleFrom,
        deliveryWindowStart: queue.deliveryWindowStart,
        deliveryWindowEnd: queue.deliveryWindowEnd,
        status: keepFutureCheck ? existing.status : queue.status,
        nextCheckAt: keepFutureCheck ? existing.nextCheckAt : queue.nextCheckAt,
        qualificationReason: keepFutureCheck
          ? existing.qualificationReason
          : queue.qualificationReason,
        resolvedReason: null,
        errorMessage: null,
      },
    });
  }

  return db.amazonReviewSolicitation.create({
    data: {
      amazonOrderId,
      marketplaceId: creds.marketplaceId,
      asin: metadata.asin ?? null,
      sku: metadata.sku ?? null,
      orderCreatedAt: metadata.orderCreatedAt ?? null,
      origem: queue.origem,
      eligibleFrom: queue.eligibleFrom,
      deliveryWindowStart: queue.deliveryWindowStart,
      deliveryWindowEnd: queue.deliveryWindowEnd,
      status: queue.status,
      nextCheckAt: queue.nextCheckAt,
      qualificationReason: queue.qualificationReason,
    },
  });
}

async function processReviewQueueRecord(
  creds: SPAPICredentials,
  record: ReviewQueueRecord,
  pausedSkus: Set<string>,
  now: Date,
) {
  if (record.deliveryWindowEnd && record.deliveryWindowEnd < now) {
    await db.amazonReviewSolicitation.update({
      where: { id: record.id },
      data: {
        status: StatusAmazonReviewSolicitation.EXPIRADO,
        nextCheckAt: null,
        resolvedReason: "EXPIRADO_JANELA_OFICIAL",
      },
    });
    return { adiado: false };
  }

  if (record.eligibleFrom && record.eligibleFrom > now) {
    await db.amazonReviewSolicitation.update({
      where: { id: record.id },
      data: {
        status: StatusAmazonReviewSolicitation.AGUARDANDO,
        nextCheckAt: record.eligibleFrom,
        qualificationReason: "AGUARDANDO_MATURIDADE_7_DIAS",
      },
    });
    return { adiado: true };
  }

  if (record.sku && pausedSkus.has(record.sku)) {
    await db.amazonReviewSolicitation.update({
      where: { id: record.id },
      data: {
        status: StatusAmazonReviewSolicitation.AGUARDANDO,
        nextCheckAt: addDays(now, 1),
        qualificationReason: "SKU_PAUSADO",
      },
    });
    return { adiado: true };
  }

  await delay(1100);
  const checked = await checkReviewSolicitationWithCreds(creds, record.amazonOrderId, {
    asin: record.asin ?? undefined,
    sku: record.sku ?? undefined,
    orderCreatedAt: record.orderCreatedAt ?? undefined,
  });

  if (checked.status !== StatusAmazonReviewSolicitation.ELEGIVEL) {
    return {
      tentado: true,
      adiado: checked.status === StatusAmazonReviewSolicitation.AGUARDANDO,
      erro:
        checked.status === StatusAmazonReviewSolicitation.ERRO
          ? `${record.amazonOrderId}: ${checked.errorMessage ?? "erro ao verificar"}`
          : undefined,
    };
  }

  await delay(1100);
  const sent = await sendReviewSolicitationWithCreds(creds, record.amazonOrderId);
  return {
    tentado: true,
    enviado: sent.status === StatusAmazonReviewSolicitation.ENVIADO,
    jaSolicitado: sent.status === StatusAmazonReviewSolicitation.JA_SOLICITADO,
    adiado: sent.status === StatusAmazonReviewSolicitation.AGUARDANDO,
    erro:
      sent.status === StatusAmazonReviewSolicitation.ERRO
        ? `${record.amazonOrderId}: ${sent.errorMessage ?? "erro ao enviar"}`
        : undefined,
  };
}

async function getDueReviewQueue(
  cutoff: Date,
  now: Date,
  take = REVIEWS_DEFAULT_BATCH_SIZE,
): Promise<ReviewQueueRecord[]> {
  return db.amazonReviewSolicitation.findMany({
    where: {
      status: { notIn: [...REVIEW_RESOLVED_STATUSES] },
      OR: [{ orderCreatedAt: null }, { orderCreatedAt: { gte: cutoff } }],
      AND: [
        {
          OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
        },
        {
          OR: [{ eligibleFrom: null }, { eligibleFrom: { lte: now } }],
        },
      ],
    },
    orderBy: [{ nextCheckAt: "asc" }, { createdAt: "asc" }],
    take,
  });
}

async function countReviewQueue(cutoff: Date) {
  return db.amazonReviewSolicitation.count({
    where: {
      status: { notIn: [...REVIEW_RESOLVED_STATUSES] },
      OR: [{ orderCreatedAt: null }, { orderCreatedAt: { gte: cutoff } }],
    },
  });
}

async function expireOldReviewQueue(fallbackCutoff: Date, now = new Date()) {
  const result = await db.amazonReviewSolicitation.updateMany({
    where: {
      status: { notIn: [...REVIEW_RESOLVED_STATUSES] },
      OR: [
        { deliveryWindowEnd: { lt: now } },
        {
          deliveryWindowEnd: null,
          orderCreatedAt: { lt: fallbackCutoff },
        },
        {
          deliveryWindowEnd: null,
          orderCreatedAt: null,
          createdAt: { lt: fallbackCutoff },
        },
      ],
    },
    data: {
      status: StatusAmazonReviewSolicitation.EXPIRADO,
      nextCheckAt: null,
      qualificationReason: "FORA_DA_JANELA_OFICIAL",
      resolvedReason: "EXPIRADO_JANELA_OFICIAL",
    },
  });
  return result.count;
}

async function getPausedReviewSkus() {
  const pausados = await db.produto.findMany({
    where: { ativo: true, solicitarReviewsAtivo: false },
    select: { sku: true },
  });
  return new Set(pausados.map((p) => p.sku));
}

async function markReviewTechnicalError(
  amazonOrderId: string,
  attemptedAt: Date,
  message: string,
) {
  return db.amazonReviewSolicitation.update({
    where: { amazonOrderId },
    data: {
      status: StatusAmazonReviewSolicitation.ERRO,
      checkedAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      attempts: { increment: 1 },
      nextCheckAt: addDays(attemptedAt, 1),
      qualificationReason: "ERRO_TECNICO",
      errorMessage: message,
      rawResponse: asJson({ message }),
    },
  });
}

function isResolvedReviewStatus(status?: string | null) {
  return (
    status === StatusAmazonReviewSolicitation.ENVIADO ||
    status === StatusAmazonReviewSolicitation.JA_SOLICITADO ||
    status === StatusAmazonReviewSolicitation.EXPIRADO
  );
}

function isAlreadySolicitedError(message: string) {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("already") ||
      normalized.includes("duplicate") ||
      normalized.includes("ja solicitado") ||
      normalized.includes("já solicitado")) &&
    (normalized.includes("solicitation") ||
      normalized.includes("request") ||
      normalized.includes("review") ||
      normalized.includes("feedback") ||
      normalized.includes("avali"))
  );
}

function isNotYetSolicitableError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not eligible") ||
    normalized.includes("not available") ||
    normalized.includes("not allowed") ||
    normalized.includes("cannot") ||
    normalized.includes("ainda nao") ||
    normalized.includes("ainda não")
  );
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Métricas agregadas para os KPI cards da página /avaliacoes.
export async function getReviewMetrics() {
  const agora = new Date();
  const config = await getReviewAutomationConfig();
  const inicioHoje = new Date(agora);
  inicioHoje.setHours(0, 0, 0, 0);
  const inicio7d = new Date(agora);
  inicio7d.setDate(inicio7d.getDate() - 7);
  const inicio30d = new Date(agora);
  inicio30d.setDate(inicio30d.getDate() - 30);
  const cutoff =
    maxDate(subDays(agora, REVIEWS_LOOKBACK_DIAS), parseConfigDate(config.backfillStartDate)) ??
    parseConfigDate(config.backfillStartDate);

  const [
    pedidos30d,
    naFila,
    tentadosHoje,
    enviadosHoje,
    enviadas7d,
    enviadas30d,
    jaSolicitados,
    adiadosAmanha,
    expirados,
    errosReais,
    elegiveisHoje,
    totalEnviadas,
    erros7d,
  ] =
    await Promise.all([
      db.amazonReviewSolicitation.count({
        where: { orderCreatedAt: { gte: cutoff } },
      }),
      countReviewQueue(cutoff),
      db.amazonReviewSolicitation.count({
        where: { lastAttemptAt: { gte: inicioHoje } },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.ENVIADO,
          sentAt: { gte: inicioHoje },
        },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.ENVIADO,
          sentAt: { gte: inicio7d },
        },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.ENVIADO,
          sentAt: { gte: inicio30d },
        },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.JA_SOLICITADO,
        },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.AGUARDANDO,
          nextCheckAt: { not: null },
        },
      }),
      db.amazonReviewSolicitation.count({
        where: { status: StatusAmazonReviewSolicitation.EXPIRADO },
      }),
      db.amazonReviewSolicitation.count({
        where: { status: StatusAmazonReviewSolicitation.ERRO },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.ELEGIVEL,
          checkedAt: { gte: inicioHoje },
        },
      }),
      db.amazonReviewSolicitation.count({
        where: { status: StatusAmazonReviewSolicitation.ENVIADO },
      }),
      db.amazonReviewSolicitation.count({
        where: {
          status: StatusAmazonReviewSolicitation.ERRO,
          updatedAt: { gte: inicio7d },
        },
      }),
    ]);

  return {
    pedidos30d,
    naFila,
    tentadosHoje,
    enviadosHoje,
    enviadasHoje: enviadosHoje,
    enviadas7d,
    enviadas30d,
    jaSolicitados,
    adiadosAmanha,
    expirados,
    errosReais,
    elegiveisHoje,
    erros7d,
    totalEnviadas,
  };
}

// Lista produtos ativos com o estado do toggle individual de reviews e contagem de envios.
export async function listReviewProductToggles() {
  const produtos = await db.produto.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    select: {
      id: true,
      sku: true,
      asin: true,
      nome: true,
      imagemUrl: true,
      solicitarReviewsAtivo: true,
    },
  });

  if (produtos.length === 0) return [];

  const contagens = await db.amazonReviewSolicitation.groupBy({
    by: ["sku"],
    where: { status: StatusAmazonReviewSolicitation.ENVIADO },
    _count: { sku: true },
    _max: { sentAt: true },
  });

  const contagemPorSku = new Map(
    contagens.map((c) => [c.sku ?? "", { total: c._count.sku, ultimo: c._max.sentAt }]),
  );

  return produtos.map((p) => {
    const info = contagemPorSku.get(p.sku);
    return {
      ...p,
      totalEnviadas: info?.total ?? 0,
      ultimaEnvioEm: info?.ultimo ?? null,
    };
  });
}

export async function toggleProdutoReviews(produtoId: string, ativo: boolean) {
  return db.produto.update({
    where: { id: produtoId },
    data: { solicitarReviewsAtivo: ativo },
    select: { id: true, sku: true, solicitarReviewsAtivo: true },
  });
}

export async function runReviewDiscovery() {
  const config = await getReviewAutomationConfig();
  if (!config.automacaoAtiva) {
    return { executada: false, motivo: "Automacao desativada.", pedidos30d: 0 };
  }

  const creds = await getCredentialsOrThrow();
  const now = new Date();
  const backfillStart = parseConfigDate(config.backfillStartDate);
  const cursor = await getSystemConfig(REVIEWS_DISCOVERY_CURSOR_KEY);
  const cursorDate = cursor ? new Date(cursor) : null;
  const startDate =
    cursorDate && Number.isFinite(cursorDate.getTime())
      ? maxDate(backfillStart, cursorDate) ?? backfillStart
      : backfillStart;
  const logId = (
    await createLog(
      TipoAmazonSync.REVIEWS,
      StatusAmazonSync.PROCESSANDO,
      "Descoberta automatica de pedidos para reviews",
    )
  ).id;

  try {
    const descoberta = await enqueueRecentReviewOrders(
      creds,
      now,
      startDate,
      config,
      startDate <= backfillStart
        ? OrigemAmazonReviewSolicitation.BACKFILL
        : OrigemAmazonReviewSolicitation.DAILY,
    );

    if (descoberta.maxOrderCreatedAt && !descoberta.rateLimited) {
      await setSystemConfig(
        REVIEWS_DISCOVERY_CURSOR_KEY,
        new Date(descoberta.maxOrderCreatedAt.getTime() + 1).toISOString(),
      );
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.SUCESSO,
        mensagem: `${descoberta.pedidos30d} pedidos avaliados para fila de reviews.`,
        detalhes: asJson({
          startDate: startDate.toISOString(),
          cursor: descoberta.maxOrderCreatedAt?.toISOString() ?? null,
          rateLimited: descoberta.rateLimited,
        }),
        registros: descoberta.pedidos30d,
      },
    });

    return {
      executada: true,
      pedidos30d: descoberta.pedidos30d,
      rateLimited: descoberta.rateLimited,
      cursor: descoberta.maxOrderCreatedAt?.toISOString() ?? null,
    };
  } catch (e) {
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: errorToMessage(e),
      },
    });
    throw e;
  }
}

export async function runReviewSendBatch(): Promise<ReviewAutomationResult> {
  const config = await getReviewAutomationConfig();
  if (!config.automacaoAtiva) {
    return emptyReviewAutomationResult("Automacao desativada.");
  }

  const creds = await getCredentialsOrThrow();
  const now = new Date();
  const cutoff = parseConfigDate(config.backfillStartDate);
  const logId = (
    await createLog(
      TipoAmazonSync.REVIEWS,
      StatusAmazonSync.PROCESSANDO,
      "Envio automatizado de solicitacoes de reviews",
    )
  ).id;
  const erros: string[] = [];
  let tentadosHoje = 0;
  let enviadosHoje = 0;
  let jaSolicitados = 0;
  let adiadosAmanha = 0;
  let errosReais = 0;

  try {
    const expirados = await expireOldReviewQueue(subDays(now, 45), now);
    const queue = await getDueReviewQueue(cutoff, now, config.dailyBatchSize);
    const pausedSkus = await getPausedReviewSkus();

    for (const record of queue) {
      const result = await processReviewQueueRecord(creds, record, pausedSkus, now);
      if (result.tentado) tentadosHoje += 1;
      if (result.enviado) enviadosHoje += 1;
      if (result.jaSolicitado) jaSolicitados += 1;
      if (result.adiado) adiadosAmanha += 1;
      if (result.erro) {
        errosReais += 1;
        erros.push(result.erro);
      }
    }

    const naFila = await countReviewQueue(cutoff);
    await markAutomationRun(new Date());
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: erros.length ? StatusAmazonSync.ERRO : StatusAmazonSync.SUCESSO,
        mensagem:
          `Reviews: ${tentadosHoje} tentados, ${enviadosHoje} enviados, ` +
          `${adiadosAmanha} adiados`,
        detalhes: asJson({
          naFila,
          tentadosHoje,
          enviadosHoje,
          jaSolicitados,
          adiadosAmanha,
          expirados,
          erros,
        }),
        registros: enviadosHoje,
      },
    });

    return {
      executada: true,
      pedidos30d: 0,
      naFila,
      tentadosHoje,
      enviadosHoje,
      jaSolicitados,
      adiadosAmanha,
      expirados,
      errosReais,
      verificados: tentadosHoje,
      enviados: enviadosHoje,
      ignorados: jaSolicitados + adiadosAmanha + expirados,
      erros,
    };
  } catch (e) {
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: errorToMessage(e),
      },
    });
    throw e;
  }
}

export async function runDailyReviewAutomation(): Promise<ReviewAutomationResult> {
  const discovery = await runReviewDiscovery();
  const sent = await runReviewSendBatch();
  return {
    ...sent,
    pedidos30d: discovery.pedidos30d ?? sent.pedidos30d,
  };
}

// Execução diária automática (chamada pelo Vercel Cron).
// Respeita toggle master + toggle por SKU, e processa em batch para caber
// dentro do timeout da serverless function.
async function runDailyReviewAutomationLegacy(): Promise<{
  executada: boolean;
  motivo?: string;
  verificados: number;
  enviados: number;
  ignorados: number;
  erros: string[];
}> {
  const { automacaoAtiva } = await getReviewAutomationConfig();
  if (!automacaoAtiva) {
    return {
      executada: false,
      motivo: "Automação desativada.",
      verificados: 0,
      enviados: 0,
      ignorados: 0,
      erros: [],
    };
  }

  const creds = await getCredentialsOrThrow();
  const logId = (
    await createLog(TipoAmazonSync.REVIEWS, StatusAmazonSync.PROCESSANDO, "Cron diário")
  ).id;

  // SKUs pausados (toggle OFF) devem ser pulados.
  const pausados = await db.produto.findMany({
    where: { ativo: true, solicitarReviewsAtivo: false },
    select: { sku: true },
  });
  const skusPausados = new Set(pausados.map((p) => p.sku));

  let verificados = 0;
  let enviados = 0;
  let ignorados = 0;
  const erros: string[] = [];

  try {
    const orders = await getOrders(
      creds,
      subDays(new Date(), REVIEWS_LOOKBACK_DIAS),
      50,
    );

    // Filtra pedidos que (a) ainda não foram enviados e (b) não estão pausados.
    const candidatos: SPOrder[] = [];
    for (const order of orders) {
      const existing = await db.amazonReviewSolicitation.findUnique({
        where: { amazonOrderId: order.orderId },
      });

      if (
        existing?.sentAt ||
        existing?.status === StatusAmazonReviewSolicitation.ENVIADO
      ) {
        ignorados++;
        continue;
      }

      const meta = getOrderMetadata(order);
      if (meta.sku && skusPausados.has(meta.sku)) {
        ignorados++;
        continue;
      }

      candidatos.push(order);
      if (candidatos.length >= REVIEWS_BATCH_POR_EXECUCAO) break;
    }

    for (const order of candidatos) {
      const metadata = getOrderMetadata(order);
      await delay(1100);
      const checked = await checkReviewSolicitationWithCreds(
        creds,
        order.orderId,
        metadata,
      );
      verificados++;

      if (checked.status !== StatusAmazonReviewSolicitation.ELEGIVEL) {
        ignorados++;
        continue;
      }

      await delay(1100);
      const sent = await sendReviewSolicitationWithCreds(creds, order.orderId);
      if (sent.status === StatusAmazonReviewSolicitation.ENVIADO) enviados++;
      else erros.push(`${order.orderId}: ${sent.errorMessage ?? "erro ao enviar"}`);
    }

    const agora = new Date();
    await markAutomationRun(agora);

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: erros.length ? StatusAmazonSync.ERRO : StatusAmazonSync.SUCESSO,
        mensagem: `Cron: ${verificados} verificados, ${enviados} enviados, ${ignorados} ignorados`,
        detalhes: asJson(erros.length ? erros : null),
        registros: enviados,
      },
    });

    return { executada: true, verificados, enviados, ignorados, erros };
  } catch (e) {
    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.ERRO,
        mensagem: e instanceof Error ? e.message : "Erro desconhecido no cron",
      },
    });
    throw e;
  }
}

// ── B1: Catálogo Amazon (Catalog Items API) ─────────────────────────────────

export type SyncCatalogResult = {
  total: number;
  atualizados: number;
  erros: string[];
};

export async function syncCatalog(produtoIds?: string[]): Promise<SyncCatalogResult> {
  const config = await getAmazonConfig();
  const creds = buildCredentials(config);
  if (!creds) throw new Error("Amazon SP-API não configurada");

  const where = {
    ativo: true,
    asin: { not: null },
    ...(produtoIds ? { id: { in: produtoIds } } : {}),
  };

  const produtos = await db.produto.findMany({
    where,
    select: { id: true, asin: true },
  });

  let atualizados = 0;
  const erros: string[] = [];

  for (const produto of produtos) {
    if (!produto.asin) continue;
    try {
      const item = await getCatalogItem(creds, produto.asin);
      if (!item) continue;

      const summary = item.summaries?.find((s) => s.marketplaceId === creds.marketplaceId)
        ?? item.summaries?.[0];

      const imagens = item.images?.find((i) => i.marketplaceId === creds.marketplaceId)
        ?? item.images?.[0];
      const mainImage = imagens?.images?.find((img) => img.variant === "MAIN")
        ?? imagens?.images?.[0];

      const classificacoes = item.classifications?.find(
        (c) => c.marketplaceId === creds.marketplaceId,
      ) ?? item.classifications?.[0];
      const categoria = classificacoes?.classifications?.[0]?.displayName;

      await db.produto.update({
        where: { id: produto.id },
        data: {
          amazonTituloOficial: summary?.itemName ?? null,
          amazonImagemUrl: mainImage?.link ?? null,
          amazonCategoria: categoria ?? null,
          amazonCatalogSyncEm: new Date(),
        },
      });
      atualizados++;
    } catch (e) {
      erros.push(`${produto.asin}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { total: produtos.length, atualizados, erros };
}

// ── B2: Buybox Status (Product Pricing API) ──────────────────────────────────

export type SyncBuyboxResult = {
  total: number;
  atualizados: number;
  erros: string[];
};

export async function syncBuybox(produtoIds?: string[]): Promise<SyncBuyboxResult> {
  const config = await getAmazonConfig();
  const creds = buildCredentials(config);
  if (!creds) throw new Error("Amazon SP-API não configurada");

  const where = {
    ativo: true,
    asin: { not: null },
    ...(produtoIds ? { id: { in: produtoIds } } : {}),
  };

  const produtos = await db.produto.findMany({
    where,
    select: { id: true, asin: true },
  });

  let atualizados = 0;
  const erros: string[] = [];

  for (const produto of produtos) {
    if (!produto.asin) continue;
    try {
      const offers = await getProductOffers(creds, produto.asin);
      if (!offers) continue;

      // Verificar se somos o vendedor com o buybox
      const sellerId = config.amazon_seller_id ?? "";
      const minhaOferta = offers.offers?.find((o) => o.sellerId === sellerId);
      const buyboxGanho = minhaOferta?.isBuyBoxWinner ?? false;

      // Preço do buybox (primeira entrada em buyBoxPrices com condição New)
      const buyboxPriceData = offers.summary?.buyBoxPrices?.find(
        (p) => p.condition === "New",
      );
      const buyboxPrecoFloat =
        buyboxPriceData?.listingPrice?.amount ??
        buyboxPriceData?.landedPrice?.amount ??
        null;
      const buyboxPreco = buyboxPrecoFloat != null
        ? Math.round(buyboxPrecoFloat * 100)
        : null;

      // Total de concorrentes elegíveis para buybox
      const concorrentes =
        offers.summary?.buyBoxEligibleOffers?.reduce((s, o) => s + (o.offerCount ?? 0), 0)
        ?? offers.offers?.length
        ?? 0;

      await db.produto.update({
        where: { id: produto.id },
        data: {
          buyboxGanho,
          buyboxPreco,
          buyboxConcorrentes: concorrentes,
          buyboxUltimaSyncEm: new Date(),
        },
      });
      atualizados++;
    } catch (e) {
      erros.push(`${produto.asin}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { total: produtos.length, atualizados, erros };
}

// ── Settlement Reports (Reports API) ────────────────────────────────────────

type SettlementSummary = {
  settlementId: string;
  startDate: string;
  endDate: string;
  depositDate: string;
  totalAmount: number;
  currency: string;
};

function parseSettlementFlatFile(content: string): SettlementSummary | null {
  const lines = content.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 2) return null;

  let headerRow: string[] | null = null;
  let summaryRow: string[] | null = null;

  for (const line of nonEmpty) {
    const cells = line.split("\t").map((c) => c.trim());
    if (cells[0]?.toLowerCase() === "settlement-id") {
      if (!headerRow) headerRow = cells;
    } else if (cells[0] && /^\d{6,}$/.test(cells[0])) {
      if (!summaryRow) summaryRow = cells;
    }
  }

  if (!headerRow || !summaryRow) return null;

  const idx = (name: string) =>
    headerRow!.findIndex((h) => h.toLowerCase() === name);

  const settlementId = summaryRow[idx("settlement-id")]?.trim() ?? "";
  if (!settlementId) return null;

  return {
    settlementId,
    startDate: summaryRow[idx("settlement-start-date")]?.trim() ?? "",
    endDate: summaryRow[idx("settlement-end-date")]?.trim() ?? "",
    depositDate: summaryRow[idx("deposit-date")]?.trim() ?? "",
    totalAmount:
      parseFloat(summaryRow[idx("total-amount")]?.trim() ?? "0") || 0,
    currency: summaryRow[idx("currency")]?.trim() ?? "BRL",
  };
}

export type SyncSettlementResult = {
  disponiveis: number;
  processados: number;
  reconciliados: number;
  erros: number;
};

export async function syncSettlementReports(): Promise<SyncSettlementResult> {
  const config = await getAmazonConfig();
  const creds = buildCredentials(config);
  if (!creds) throw new Error("Amazon SP-API não configurada");

  const reports = await getSettlementReports(creds);
  const doneReports = reports.filter(
    (r) => r.processingStatus === "DONE" && r.reportDocumentId,
  );

  let processados = 0;
  let reconciliados = 0;
  let erros = 0;

  for (const report of doneReports) {
    const existing = await db.amazonSettlementReport.findUnique({
      where: { reportId: report.reportId },
    });
    if (existing?.processadoEm) continue;

    try {
      const doc = await getReportDocument(creds, report.reportDocumentId!);
      if (!doc) {
        erros++;
        continue;
      }

      const fetchResponse = await fetch(doc.url);
      if (!fetchResponse.ok) {
        erros++;
        continue;
      }

      let content: string;
      if (doc.compressionAlgorithm === "GZIP") {
        const buffer = Buffer.from(await fetchResponse.arrayBuffer());
        content = gunzipSync(buffer).toString("utf-8");
      } else {
        content = await fetchResponse.text();
      }

      const summary = parseSettlementFlatFile(content);
      if (!summary) {
        erros++;
        continue;
      }

      const totalCentavos = Math.round(Math.abs(summary.totalAmount) * 100);
      const depositDate = summary.depositDate
        ? new Date(summary.depositDate)
        : null;
      const periodoInicio = summary.startDate
        ? new Date(summary.startDate)
        : null;
      const periodoFim = summary.endDate ? new Date(summary.endDate) : null;

      await db.amazonSettlementReport.upsert({
        where: { reportId: report.reportId },
        create: {
          reportId: report.reportId,
          reportDocumentId: report.reportDocumentId,
          settlementId: summary.settlementId || null,
          periodoInicio,
          periodoFim,
          depositDate,
          totalAmountCentavos: totalCentavos,
          processadoEm: new Date(),
        },
        update: {
          settlementId: summary.settlementId || null,
          periodoInicio,
          periodoFim,
          depositDate,
          totalAmountCentavos: totalCentavos,
          processadoEm: new Date(),
        },
      });

      if (summary.settlementId && depositDate) {
        const conta = await db.contaReceber.findFirst({
          where: {
            liquidacaoId: summary.settlementId,
            status: StatusContaReceber.PENDENTE,
          },
        });
        if (conta) {
          await db.contaReceber.update({
            where: { id: conta.id },
            data: {
              status: StatusContaReceber.RECEBIDA,
              dataRecebimento: depositDate,
              valor: Math.max(conta.valor, totalCentavos),
            },
          });
          reconciliados++;
        }
      }

      processados++;
    } catch {
      erros++;
    }
  }

  return { disponiveis: doneReports.length, processados, reconciliados, erros };
}
