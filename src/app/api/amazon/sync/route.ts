import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import {
  testConnection,
} from "@/modules/amazon/service";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({})) as { tipo?: string; diasAtras?: number };
  const tipo = body.tipo ?? "ALL";

  if (tipo === "TEST") {
    const result = await testConnection();
    return ok(result);
  }

  const jobs = [];

  if (tipo === "ORDERS" || tipo === "ALL") {
    const diasAtras = body.diasAtras ?? 30;
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.ORDERS_SYNC,
      { diasAtras, maxPages: 1 },
      {
        priority: 50,
        dedupeKey: `manual:${TipoAmazonSyncJob.ORDERS_SYNC}:${diasAtras}`,
      },
    );
    jobs.push(job);
    if (tipo === "ORDERS") return ok({ ok: true, queued: true, job });
  }

  if (tipo === "FINANCES" || tipo === "ALL") {
    const diasAtras = body.diasAtras ?? 14;
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.FINANCES_SYNC,
      { diasAtras, maxPages: 1 },
      {
        priority: 40,
        dedupeKey: `manual:${TipoAmazonSyncJob.FINANCES_SYNC}:${diasAtras}`,
      },
    );
    jobs.push(job);
    if (tipo === "FINANCES") return ok({ ok: true, queued: true, job });
  }

  if (tipo === "REFUNDS" || tipo === "ALL") {
    const diasAtras = body.diasAtras ?? 90;
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.REFUNDS_SYNC,
      { diasAtras, maxPages: 1 },
      {
        priority: 40,
        dedupeKey: `manual:${TipoAmazonSyncJob.REFUNDS_SYNC}:${diasAtras}`,
      },
    );
    jobs.push(job);
    if (tipo === "REFUNDS") return ok({ ok: true, queued: true, job });
  }

  if (tipo === "BACKFILL" || tipo === "REPORTS_BACKFILL") {
    // Backfill histórico via Reports API (GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL).
    // Avança UMA janela de 30d por execução; auto-encerra ao alcançar now-2d.
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.REPORTS_BACKFILL,
      {},
      {
        priority: 60,
        dedupeKey: `manual:${TipoAmazonSyncJob.REPORTS_BACKFILL}`,
      },
    );
    return ok({ ok: true, queued: true, job });
  }

  if (tipo === "INVENTORY" || tipo === "ALL") {
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.INVENTORY_SYNC,
      {},
      {
        priority: 30,
        dedupeKey: `manual:${TipoAmazonSyncJob.INVENTORY_SYNC}`,
      },
    );
    jobs.push(job);
    if (tipo === "INVENTORY") return ok({ ok: true, queued: true, job });
  }

  if (tipo === "REVIEWS") {
    const discovery = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.REVIEWS_DISCOVERY,
      {},
      {
        priority: 55,
        dedupeKey: `manual:${TipoAmazonSyncJob.REVIEWS_DISCOVERY}`,
      },
    );
    const send = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.REVIEWS_SEND,
      {},
      {
        priority: 54,
        dedupeKey: `manual:${TipoAmazonSyncJob.REVIEWS_SEND}`,
      },
    );
    return ok({ ok: true, queued: true, jobs: [discovery, send] });
  }

  return ok({ ok: true, queued: true, jobs });
});
