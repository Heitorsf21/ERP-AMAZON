/**
 * Handler do job AMAZON_ADS_STREAM_INGEST.
 *
 * Recebe records do Marketing Stream (ja extraidos do SQS body pelo dispatcher
 * em amazon-sqs.ts), normaliza via parser e faz upsert idempotente em
 * AmazonAdsMetricaHoraria.
 *
 * Idempotencia: chave unica (horaInicio, dataset, campaignId, adGroupId, adId,
 * asin, sku). Marketing Stream entrega agregados cumulativos por bucket — last
 * write wins. Audit em eventoTimeMin/Max.
 *
 * Reconciliacao com daily report: o cleanup de hourly antigo acontece em
 * ads-handlers.ts (apos upsert do daily). Esse handler so escreve.
 *
 * Backfill: Marketing Stream e forward-only. Historico vem do daily report
 * existente (AMAZON_ADS_BACKFILL).
 */

import { db } from "@/lib/db";
import {
  parseMarketingStreamMessage,
  type MarketingStreamParsedRow,
} from "@/modules/amazon/parsers/marketing-stream-events";
import type { AmazonSqsNotification } from "@/lib/amazon-sqs";

type StreamIngestPayload = {
  notif?: AmazonSqsNotification;
  records?: unknown[];
  dataset?: string;
  profileId?: string;
  dedupeKey?: string;
};

export async function runMarketingStreamIngest(payload: StreamIngestPayload) {
  const notif = extractNotification(payload);
  if (!notif) {
    return { ok: false, motivo: "payload-sem-notif" } as const;
  }

  const rows = parseMarketingStreamMessage(notif);
  if (rows.length === 0) {
    return { ok: true, ingeridas: 0, motivo: "sem-rows" } as const;
  }

  const stats = await upsertMarketingStreamRows(rows);
  return {
    ok: true,
    dataset: rows[0]?.dataset ?? null,
    ingeridas: rows.length,
    ...stats,
  };
}

function extractNotification(payload: StreamIngestPayload): AmazonSqsNotification | null {
  if (payload.notif) return payload.notif;
  if (payload.records && payload.dataset) {
    return {
      payload: {
        datasetId: payload.dataset,
        records: payload.records,
      },
    } as AmazonSqsNotification;
  }
  return null;
}

async function upsertMarketingStreamRows(rows: MarketingStreamParsedRow[]) {
  let novas = 0;
  let atualizadas = 0;

  const skus = Array.from(
    new Set(rows.map((r) => r.sku).filter((s): s is string => !!s)),
  );
  const produtos = skus.length
    ? await db.produto.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true },
      })
    : [];
  const produtoIdBySku = new Map(produtos.map((p) => [p.sku, p.id]));

  for (const r of rows) {
    const produtoId = r.sku ? produtoIdBySku.get(r.sku) ?? null : null;
    const eventTime = r.eventoTime;

    const data = {
      horaInicio: r.horaInicio,
      dataset: r.dataset,
      profileId: r.profileId,
      campaignId: r.campaignId,
      adGroupId: r.adGroupId,
      adId: r.adId,
      asin: r.asin,
      sku: r.sku,
      impressoes: r.impressoes,
      cliques: r.cliques,
      gastoCentavos: r.gastoCentavos,
      vendasCentavos: r.vendasCentavos,
      unidades: r.unidades,
      pedidos: r.pedidos,
      produtoId,
      marketplaceId: r.marketplaceId,
      currencyCode: r.currencyCode,
      eventoTimeMin: eventTime,
      eventoTimeMax: eventTime,
      payloadJson: JSON.stringify(r.payload),
    };

    try {
      // findFirst em vez de findUnique: Prisma findUnique com composite key
      // rejeita null em campos nullable (asin/sku/adGroupId/adId). sp-traffic
      // entrega records por ad/keyword sem SKU/ASIN — todos null. findFirst
      // aceita null e o indice unico SQL tolera null != null em multiplas rows.
      const existing = await db.amazonAdsMetricaHoraria.findFirst({
        where: {
          horaInicio: r.horaInicio,
          dataset: r.dataset,
          campaignId: r.campaignId,
          adGroupId: r.adGroupId,
          adId: r.adId,
          asin: r.asin,
          sku: r.sku,
        },
      });

      if (!existing) {
        await db.amazonAdsMetricaHoraria.create({ data });
        novas++;
      } else {
        await db.amazonAdsMetricaHoraria.update({
          where: { id: existing.id },
          data: {
            ...data,
            // eventoTimeMin preserva o menor visto (idempotencia fina)
            eventoTimeMin:
              eventTime < existing.eventoTimeMin ? eventTime : existing.eventoTimeMin,
            eventoTimeMax:
              eventTime > existing.eventoTimeMax ? eventTime : existing.eventoTimeMax,
          },
        });
        atualizadas++;
      }
    } catch (err) {
      console.warn(
        "[marketing-stream] upsert falhou",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { criadas: novas, atualizadas };
}
