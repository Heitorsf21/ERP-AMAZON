import { isAmazonQuotaCooldownError } from "@/lib/amazon-rate-limit";
import { db } from "@/lib/db";
import { notificarJobFalhando } from "@/lib/notificacoes";
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
  getAmazonConfig,
  isAmazonConfigured,
} from "@/modules/amazon/service";
import {
  runBuyboxCheck,
  runCatalogRefresh,
  runFbaReimbursementsSync,
  runFbaStorageFeesSync,
  runFinancesBackfill,
  runInventorySnapshot,
  runReturnsSync,
  runSettlementBackfill,
  runTrafficSync,
  syncOrdersHistoryReport,
  syncSettlementReports,
  reconciliarRecebimentosAmazon,
} from "@/modules/amazon/jobs-handlers";
import {
  runAmazonAdsBackfill,
  runAmazonAdsReportSync,
} from "@/modules/amazon/ads-handlers";
import { getAmazonAdsCredentials } from "@/modules/amazon/ads-service";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

const HEARTBEAT_KEY = "worker_heartbeat_at";

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

      // Notificacao no sino do ERP quando job esgota tentativas.
      if (job.attempts >= job.maxAttempts && !retryAt) {
        try {
          await notificarJobFalhando({
            jobId: job.id,
            tipo: job.tipo,
            attempts: job.attempts,
            error: message,
          });
        } catch {
          // Nunca propaga erro de notificacao.
        }
      }

      results.push({
        jobId: job.id,
        tipo: job.tipo,
        status: retryAt ? "RETRY" : "FAILED",
        error: message,
        runAfter: retryAt?.toISOString(),
      });
    }
  }

  // Heartbeat: outras partes do sistema (health endpoint, watchdog)
  // usam isso para detectar worker travado.
  await writeHeartbeat();

  // Reconciliação Nubank ↔ ContaReceber (sem custo de SP-API).
  // Roda a cada loop, é barato e dá liquidação automática rápida.
  try {
    await reconciliarRecebimentosAmazon();
  } catch (e) {
    console.warn("reconciliarRecebimentosAmazon erro:", e);
  }

  return { processed: results.length, results };
}

async function writeHeartbeat() {
  const valor = new Date().toISOString();
  try {
    await db.configuracaoSistema.upsert({
      where: { chave: HEARTBEAT_KEY },
      create: { chave: HEARTBEAT_KEY, valor },
      update: { valor },
    });
  } catch {
    // Heartbeat é best-effort.
  }
}

async function processJob(
  tipo: string,
  payloadRaw: Parameters<typeof parseJobPayload>[0],
) {
  const payload = parseJobPayload<SyncPayload>(payloadRaw);

  // Jobs Ads usam outras credenciais (advertising LWA scope) — tratados a parte.
  const isAdsJob =
    tipo === TipoAmazonSyncJob.AMAZON_ADS_REPORT_SYNC ||
    tipo === TipoAmazonSyncJob.AMAZON_ADS_BACKFILL;

  // Para jobs que precisam de credenciais SP-API, busca-as uma única vez.
  // REVIEWS_DISCOVERY/SEND buscam suas próprias creds via getCredentialsOrThrow.
  const needCreds =
    !isAdsJob &&
    tipo !== TipoAmazonSyncJob.REVIEWS_DISCOVERY &&
    tipo !== TipoAmazonSyncJob.REVIEWS_SEND;

  let creds: Awaited<ReturnType<typeof getAmazonConfig>> | null = null;
  if (needCreds) {
    creds = await getAmazonConfig();
    if (!isAmazonConfigured(creds)) {
      return {
        ok: false,
        skipped: true,
        mensagem: "Credenciais Amazon nao configuradas — job pulado.",
      };
    }
  }

  const sp = creds
    ? {
        clientId: creds.amazon_client_id!,
        clientSecret: creds.amazon_client_secret!,
        refreshToken: creds.amazon_refresh_token!,
        marketplaceId: creds.amazon_marketplace_id!,
        endpoint: creds.amazon_endpoint || undefined,
      }
    : null;

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
    case TipoAmazonSyncJob.SETTLEMENT_REPORT_SYNC:
      return syncSettlementReports(sp!);
    case TipoAmazonSyncJob.BUYBOX_CHECK:
      return runBuyboxCheck(sp!);
    case TipoAmazonSyncJob.CATALOG_REFRESH:
      return runCatalogRefresh(sp!);
    case TipoAmazonSyncJob.REPORTS_BACKFILL:
      return syncOrdersHistoryReport(sp!);
    case TipoAmazonSyncJob.FINANCES_BACKFILL:
      return runFinancesBackfill(sp!);
    case TipoAmazonSyncJob.SETTLEMENT_BACKFILL:
      return runSettlementBackfill(sp!);
    case TipoAmazonSyncJob.INVENTORY_SNAPSHOT:
      return runInventorySnapshot(sp!);
    case TipoAmazonSyncJob.FBA_REIMBURSEMENTS_SYNC:
      return runFbaReimbursementsSync(sp!, payload);
    case TipoAmazonSyncJob.RETURNS_SYNC:
      return runReturnsSync(sp!, payload);
    case TipoAmazonSyncJob.FBA_STORAGE_SYNC:
      return runFbaStorageFeesSync(sp!);
    case TipoAmazonSyncJob.TRAFFIC_SYNC:
      return runTrafficSync(sp!, payload);
    case TipoAmazonSyncJob.AMAZON_ADS_REPORT_SYNC: {
      const adsCreds = await getAmazonAdsCredentials();
      if (!adsCreds) {
        return {
          ok: false,
          skipped: true,
          mensagem:
            "Credenciais Amazon Advertising nao configuradas — job pulado.",
        };
      }
      return runAmazonAdsReportSync(adsCreds, payload);
    }
    case TipoAmazonSyncJob.AMAZON_ADS_BACKFILL: {
      const adsCreds = await getAmazonAdsCredentials();
      if (!adsCreds) {
        return {
          ok: false,
          skipped: true,
          mensagem:
            "Credenciais Amazon Advertising nao configuradas — job pulado.",
        };
      }
      return runAmazonAdsBackfill(adsCreds);
    }
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
