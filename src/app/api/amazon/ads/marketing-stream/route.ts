/**
 * Admin endpoint para gerenciar subscriptions do Amazon Marketing Stream.
 *
 *  GET    — lista estado consolidado por dataset (subscriptionId, status, lastSeenAt)
 *  POST   — assina datasets (idempotente). Body: { datasets: string[] }
 *  DELETE — arquiva subscription. Body: { dataset: string }
 *
 * Requer ADMIN. Usa AMAZON_SQS_QUEUE_ARN do env como destinationArn.
 */

import { erro, handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import {
  ADS_REQUIRED_CONFIG_KEYS,
  buildAdsCredentials,
  getAmazonAdsConfig,
} from "@/modules/amazon/ads-service";
import {
  archiveMarketingStreamDataset,
  getMarketingStreamQueueArn,
  getMarketingStreamSubscriptionStates,
  isMarketingStreamDataset,
  subscribeMarketingStreamDataset,
} from "@/modules/amazon/marketing-stream-service";
import type { MarketingStreamDataset } from "@/modules/amazon/parsers/marketing-stream-events";

export const dynamic = "force-dynamic";

async function getCredentialsOrError() {
  const config = await getAmazonAdsConfig();
  const missing = ADS_REQUIRED_CONFIG_KEYS.filter((k) => !config[k]);
  if (missing.length > 0) {
    return {
      creds: null,
      response: erro(400, `Campos ausentes no banco: ${missing.join(", ")}`),
    };
  }
  const creds = buildAdsCredentials(config);
  if (!creds) {
    return {
      creds: null,
      response: erro(400, "Credenciais Ads invalidas."),
    };
  }
  return { creds, response: null };
}

export const GET = handle(async () => {
  await requireRole(UsuarioRole.ADMIN);
  const { creds } = await getCredentialsOrError();
  const states = await getMarketingStreamSubscriptionStates(creds);
  return ok({
    queueArn: getMarketingStreamQueueArn(),
    subscriptions: states.map((s) => ({
      dataset: s.dataset,
      subscriptionId: s.subscriptionId,
      status: s.status,
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
      destinationArn:
        typeof s.remoteRow?.destinationArn === "string"
          ? s.remoteRow.destinationArn
          : null,
    })),
  });
});

export const POST = handle(async (request: Request) => {
  await requireRole(UsuarioRole.ADMIN);
  const { creds, response } = await getCredentialsOrError();
  if (response) return response;

  const arn = getMarketingStreamQueueArn();
  if (!arn) {
    return erro(
      400,
      "AMAZON_SQS_QUEUE_ARN nao configurado no .env — necessario para criar subscriptions.",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    datasets?: unknown;
  };
  const datasets = Array.isArray(body.datasets) ? body.datasets : [];
  const validDatasets = datasets.filter(
    (d): d is MarketingStreamDataset =>
      typeof d === "string" && isMarketingStreamDataset(d),
  );
  if (validDatasets.length === 0) {
    return erro(400, "Body deve conter datasets: string[] valido.");
  }

  const resultados: Array<{ dataset: string; ok: boolean; erro?: string; subscriptionId?: string }> = [];
  for (const dataset of validDatasets) {
    try {
      const sub = await subscribeMarketingStreamDataset(creds!, dataset, arn);
      resultados.push({
        dataset,
        ok: true,
        subscriptionId: sub.subscriptionId,
      });
    } catch (err) {
      resultados.push({
        dataset,
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return ok({ resultados });
});

export const DELETE = handle(async (request: Request) => {
  await requireRole(UsuarioRole.ADMIN);
  const { creds, response } = await getCredentialsOrError();
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as { dataset?: unknown };
  const dataset = typeof body.dataset === "string" ? body.dataset : null;
  if (!dataset || !isMarketingStreamDataset(dataset)) {
    return erro(400, "Body deve conter dataset valido.");
  }

  try {
    const result = await archiveMarketingStreamDataset(creds!, dataset);
    return ok({ dataset, arquivado: !!result, subscriptionId: result?.subscriptionId ?? null });
  } catch (err) {
    return erro(502, err instanceof Error ? err.message : String(err));
  }
});
