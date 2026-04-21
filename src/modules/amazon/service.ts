import { db } from "@/lib/db";
import {
  createProductReviewAndSellerFeedbackSolicitation,
  getInventorySummaries,
  getMarketplaceParticipations,
  getOrders,
  getSolicitationActionsForOrder,
  type SPAPICredentials,
  type SPOrder,
} from "@/lib/amazon-sp-api";
import {
  StatusAmazonReviewSolicitation,
  StatusAmazonSync,
  TipoAmazonSync,
} from "@/modules/shared/domain";
import { subDays } from "date-fns";

// Chaves de configuração armazenadas em ConfiguracaoSistema.
export const AMAZON_CONFIG_KEYS = [
  "amazon_client_id",
  "amazon_client_secret",
  "amazon_refresh_token",
  "amazon_marketplace_id",
  "amazon_endpoint",
] as const;

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
};

export async function getAmazonConfig(): Promise<Record<string, string>> {
  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: [...AMAZON_CONFIG_KEYS] } },
  });
  const config: Record<string, string> = {};
  for (const r of registros) config[r.chave] = r.valor;

  config.amazon_client_id ||= process.env.AMAZON_LWA_CLIENT_ID ?? "";
  config.amazon_client_secret ||= process.env.AMAZON_LWA_CLIENT_SECRET ?? "";
  config.amazon_refresh_token ||= process.env.AMAZON_LWA_REFRESH_TOKEN ?? "";
  config.amazon_marketplace_id ||= process.env.AMAZON_MARKETPLACE_ID ?? "";
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

    if (!valor) {
      await db.configuracaoSistema.deleteMany({ where: { chave } });
    } else {
      await db.configuracaoSistema.upsert({
        where: { chave },
        create: { chave, valor },
        update: { valor },
      });
    }
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
      detalhes: detalhes ? JSON.stringify(detalhes) : null,
      registros,
    },
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

export async function syncOrders(diasAtras = 30): Promise<{
  lidas: number;
  pedidos: Array<{
    amazonOrderId: string;
    purchaseDate: string;
    lastUpdatedDate: string;
    asin?: string;
    sku?: string;
    quantityOrdered?: number;
  }>;
}> {
  const logId = (
    await createLog(TipoAmazonSync.ORDERS, StatusAmazonSync.PROCESSANDO)
  ).id;

  const creds = await getCredentialsOrThrow();

  try {
    const orders = await getOrders(creds, subDays(new Date(), diasAtras));
    const pedidos = orders.map((order) => {
      const firstItem = order.orderItems?.[0];
      return {
        amazonOrderId: order.orderId,
        purchaseDate: order.createdTime,
        lastUpdatedDate: order.lastUpdatedTime,
        asin: firstItem?.product?.asin,
        sku: firstItem?.product?.sellerSku,
        quantityOrdered: firstItem?.quantityOrdered,
      };
    });

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.SUCESSO,
        mensagem: `${pedidos.length} pedidos lidos pela Orders API 2026-01-01.`,
        detalhes: JSON.stringify({ pedidos: pedidos.slice(0, 20) }),
        registros: pedidos.length,
      },
    });

    return { lidas: pedidos.length, pedidos };
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

export async function syncInventory(): Promise<{
  sincronizados: number;
  divergencias: Array<{ sku: string; erp: number; amazon: number }>;
}> {
  const logId = (
    await createLog(TipoAmazonSync.INVENTORY, StatusAmazonSync.PROCESSANDO)
  ).id;

  const creds = await getCredentialsOrThrow();
  const divergencias: Array<{ sku: string; erp: number; amazon: number }> = [];
  let sincronizados = 0;

  try {
    const summaries = await getInventorySummaries(creds);

    for (const item of summaries) {
      const produto = await db.produto.findUnique({
        where: { sku: item.sellerSku },
      });

      if (!produto) continue;

      const qtdAmazon =
        item.inventoryDetails?.fulfillableQuantity ?? item.totalQuantity;

      if (produto.estoqueAtual !== qtdAmazon) {
        divergencias.push({
          sku: item.sellerSku,
          erp: produto.estoqueAtual,
          amazon: qtdAmazon,
        });
      }
      sincronizados++;
    }

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: StatusAmazonSync.SUCESSO,
        mensagem: `${sincronizados} SKUs verificados, ${divergencias.length} divergências`,
        detalhes:
          divergencias.length > 0 ? JSON.stringify(divergencias) : null,
        registros: sincronizados,
      },
    });
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

  return { sincronizados, divergencias };
}

export async function getLogs(limit = 20) {
  return db.amazonSyncLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listReviewSolicitations(limit = 100) {
  return db.amazonReviewSolicitation.findMany({
    orderBy: [{ sentAt: "desc" }, { checkedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function checkReviewSolicitation(
  amazonOrderId: string,
  metadata: OrderMetadata = {},
) {
  const creds = await getCredentialsOrThrow();
  return checkReviewSolicitationWithCreds(creds, amazonOrderId, metadata);
}

export async function sendReviewSolicitation(
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
    record = await checkReviewSolicitationWithCreds(creds, amazonOrderId, {
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
        rawResponse: JSON.stringify(response),
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

export async function processEligibleReviewSolicitations(diasAtras = 30) {
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

    await db.amazonSyncLog.update({
      where: { id: logId },
      data: {
        status: erros.length ? StatusAmazonSync.ERRO : StatusAmazonSync.SUCESSO,
        mensagem: `${verificados} verificados, ${enviados} enviados, ${ignorados} ignorados`,
        detalhes: erros.length ? JSON.stringify(erros) : null,
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
        rawResponse: JSON.stringify(result.response),
      },
      update: {
        marketplaceId: creds.marketplaceId,
        status,
        asin: metadata.asin ?? undefined,
        sku: metadata.sku ?? undefined,
        checkedAt: new Date(),
        errorMessage: null,
        rawResponse: JSON.stringify(result.response),
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

async function sendReviewSolicitationWithCreds(
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
        rawResponse: JSON.stringify(response),
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
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
