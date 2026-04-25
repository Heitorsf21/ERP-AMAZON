import { isAmazonQuotaCooldownError } from "@/lib/amazon-rate-limit";
import {
  completeAmazonSyncJob,
  ensureRecurringAmazonJobs,
  failAmazonSyncJob,
  claimNextAmazonSyncJob,
  parseJobPayload,
} from "@/modules/amazon/jobs";
import {
  runReviewDiscovery,
  runReviewSendBatch,
  syncFinances,
  syncInventory,
  syncOrders,
  syncRefunds,
} from "@/modules/amazon/service";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

type WorkerOptions = {
  workerId?: string;
  limit?: number;
  schedule?: boolean;
};

type SyncPayload = {
  diasAtras?: number;
  maxPages?: number;
};

export async function processAmazonSyncJobs(options: WorkerOptions = {}) {
  const workerId = options.workerId ?? `worker-${process.pid}-${Date.now()}`;
  const limit = options.limit ?? 10;
  const results: Array<Record<string, unknown>> = [];

  if (options.schedule !== false) {
    await ensureRecurringAmazonJobs();
  }

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextAmazonSyncJob(workerId);
    if (!job) break;

    try {
      const result = await processJob(job.tipo, job.payload);
      await completeAmazonSyncJob(job.id, result);
      results.push({ jobId: job.id, tipo: job.tipo, status: "SUCCESS", result });
    } catch (error) {
      const retryAt = getRetryAt(error);
      const message = error instanceof Error ? error.message : String(error);
      await failAmazonSyncJob({
        jobId: job.id,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error: message,
        runAfter: retryAt,
      });
      results.push({
        jobId: job.id,
        tipo: job.tipo,
        status: retryAt ? "RETRY" : "FAILED",
        error: message,
        runAfter: retryAt?.toISOString(),
      });
    }
  }

  return { processed: results.length, results };
}

async function processJob(tipo: string, payloadRaw: string | null) {
  const payload = parseJobPayload<SyncPayload>(payloadRaw);

  switch (tipo) {
    case TipoAmazonSyncJob.ORDERS_SYNC:
      return syncOrders(payload.diasAtras ?? 3, {
        maxPages: payload.maxPages ?? 1,
      });
    case TipoAmazonSyncJob.FINANCES_SYNC:
      return syncFinances(payload.diasAtras ?? 14, {
        maxPages: payload.maxPages ?? 1,
      });
    case TipoAmazonSyncJob.REFUNDS_SYNC:
      return syncRefunds(payload.diasAtras ?? 90, {
        maxPages: payload.maxPages ?? 1,
      });
    case TipoAmazonSyncJob.INVENTORY_SYNC:
      return syncInventory();
    case TipoAmazonSyncJob.REVIEWS_DISCOVERY:
      return runReviewDiscovery();
    case TipoAmazonSyncJob.REVIEWS_SEND:
      return runReviewSendBatch();
    case TipoAmazonSyncJob.REPORTS_BACKFILL:
      return {
        ok: true,
        skipped: true,
        mensagem:
          "Reports API preparada como job de backfill; parsing de settlement report entra na proxima etapa.",
      };
    default:
      throw new Error(`Tipo de job Amazon desconhecido: ${tipo}`);
  }
}

function getRetryAt(error: unknown) {
  if (isAmazonQuotaCooldownError(error)) return error.nextAllowedAt;
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/ate ([0-9TZ:.-]+)/);
  if (!match?.[1]) return undefined;
  const parsed = new Date(match[1]);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}
