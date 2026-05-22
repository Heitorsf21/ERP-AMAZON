/**
 * Service de orquestracao do Amazon Marketing Stream.
 *
 * Marketing Stream entrega eventos hourly (sp-traffic, sp-conversion, sd-*, sb-*)
 * via SQS standard, push-based. Cada subscription cobre UM dataset. Esse modulo:
 *  - Lista subscriptions existentes no Ads API
 *  - Cria/arquiva subscriptions para o ARN da nossa fila SQS
 *  - Persiste o subscriptionId por dataset em ConfiguracaoSistema
 *  - Calcula lastSeenAt (max eventoTimeMax) por dataset para a UI admin
 *
 * Variaveis de ambiente / config relevantes:
 *  - AMAZON_SQS_QUEUE_ARN (ARN da fila destino do Marketing Stream)
 *  - AMAZON_SQS_QUEUE_URL (URL da fila; reusada do SP-API consumer)
 */

import { db } from "@/lib/db";
import {
  archiveMarketingStreamSubscription as archiveSubscriptionApi,
  listMarketingStreamSubscriptions as listSubscriptionsApi,
  putMarketingStreamSubscription as putSubscriptionApi,
  type AdsAPICredentials,
  type MarketingStreamSubscription,
} from "@/lib/amazon-ads-api";
import {
  MARKETING_STREAM_DATASETS,
  type MarketingStreamDataset,
} from "@/modules/amazon/parsers/marketing-stream-events";

const SUBSCRIPTION_CFG_PREFIX = "amazon_ads_stream_subscription_";

export type MarketingStreamSubscriptionState = {
  dataset: MarketingStreamDataset;
  subscriptionId: string | null;
  status: string | null;
  lastSeenAt: Date | null;
  remoteRow: MarketingStreamSubscription | null;
};

export function isMarketingStreamDataset(value: string): value is MarketingStreamDataset {
  return (MARKETING_STREAM_DATASETS as readonly string[]).includes(value);
}

export function getMarketingStreamQueueArn(): string | null {
  return process.env.AMAZON_SQS_QUEUE_ARN || null;
}

async function getCfg(chave: string): Promise<string | null> {
  const row = await db.configuracaoSistema.findUnique({ where: { chave } });
  return row?.valor ?? null;
}

async function setCfg(chave: string, valor: string): Promise<void> {
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
}

async function delCfg(chave: string): Promise<void> {
  await db.configuracaoSistema.deleteMany({ where: { chave } });
}

function cfgKey(dataset: MarketingStreamDataset): string {
  return `${SUBSCRIPTION_CFG_PREFIX}${dataset}`;
}

/**
 * Estado consolidado por dataset:
 *  - subscriptionId (do nosso config local)
 *  - status remoto (ACTIVE/ARCHIVED) e ARN, se a chamada listar funcionar
 *  - lastSeenAt: ultimo eventoTimeMax visto em AmazonAdsMetricaHoraria
 */
export async function getMarketingStreamSubscriptionStates(
  creds: AdsAPICredentials | null,
): Promise<MarketingStreamSubscriptionState[]> {
  const remoteList: MarketingStreamSubscription[] = creds
    ? await listSubscriptionsApi(creds).catch((err) => {
        console.warn(
          "[marketing-stream] falha listar subscriptions:",
          err instanceof Error ? err.message : String(err),
        );
        return [];
      })
    : [];

  const lastSeenByDataset = await getLastSeenByDataset();

  const states: MarketingStreamSubscriptionState[] = [];
  for (const dataset of MARKETING_STREAM_DATASETS) {
    const localId = await getCfg(cfgKey(dataset));
    const remoteRow =
      remoteList.find(
        (s) =>
          (s.dataSetId ?? "").toLowerCase() === dataset ||
          (localId && s.subscriptionId === localId),
      ) ?? null;
    states.push({
      dataset,
      subscriptionId: remoteRow?.subscriptionId ?? localId ?? null,
      status: remoteRow?.status ?? (localId ? "UNKNOWN" : null),
      lastSeenAt: lastSeenByDataset.get(dataset) ?? null,
      remoteRow,
    });
  }
  return states;
}

async function getLastSeenByDataset(): Promise<Map<MarketingStreamDataset, Date>> {
  const grupos = await db.amazonAdsMetricaHoraria.groupBy({
    by: ["dataset"],
    _max: { eventoTimeMax: true },
  });
  const out = new Map<MarketingStreamDataset, Date>();
  for (const g of grupos) {
    if (!isMarketingStreamDataset(g.dataset)) continue;
    if (g._max.eventoTimeMax) out.set(g.dataset, g._max.eventoTimeMax);
  }
  return out;
}

/**
 * Cria ou re-utiliza subscription para o dataset. Idempotente: se ja existe
 * uma subscription remota com mesmo destinationArn, reusa o subscriptionId.
 */
export async function subscribeMarketingStreamDataset(
  creds: AdsAPICredentials,
  dataset: MarketingStreamDataset,
  destinationArn: string,
): Promise<MarketingStreamSubscription> {
  const result = await putSubscriptionApi(creds, {
    dataSetId: dataset,
    destinationArn,
    notes: `erp-amazon ${dataset} subscription`,
    clientRequestToken: `erp-${dataset}-${Date.now()}`,
  });
  if (result.subscriptionId) {
    await setCfg(cfgKey(dataset), result.subscriptionId);
  }
  return result;
}

export async function archiveMarketingStreamDataset(
  creds: AdsAPICredentials,
  dataset: MarketingStreamDataset,
): Promise<MarketingStreamSubscription | null> {
  const subscriptionId = await getCfg(cfgKey(dataset));
  if (!subscriptionId) return null;
  const result = await archiveSubscriptionApi(creds, subscriptionId);
  await delCfg(cfgKey(dataset));
  return result;
}
