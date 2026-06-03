import { isAmazonQuotaCooldownError } from "@/lib/amazon-rate-limit";
import type { SPAPICredentials } from "@/lib/amazon-sp-api";
import { pollSqsNotifications } from "@/lib/amazon-sqs";
import { db } from "@/lib/db";
import { getEmpresaId, runWithTenant } from "@/lib/tenant-context";
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
  resolverCredenciaisDaConta,
} from "@/modules/amazon/service";
import {
  runAmazonFbaPromoExpiryCheck,
  runAmazonFeeEstimateSync,
  runBuyboxCheck,
  runCatalogRefresh,
  runFbaReimbursementsSync,
  runFbaStorageFeesSync,
  runFinancesBackfill,
  runInventorySnapshot,
  runListingPriceSync,
  runReturnsSync,
  runSettlementBackfill,
  runTrafficSync,
  syncOrdersHistoryReport,
  syncSettlementReports,
  reconciliarRecebimentosAmazon,
} from "@/modules/amazon/jobs-handlers";
import { subDays } from "date-fns";
import {
  runAmazonAdsBackfill,
  runAmazonAdsReportSync,
} from "@/modules/amazon/ads-handlers";
import { getAmazonAdsCredentials } from "@/modules/amazon/ads-service";
import { runMarketingStreamIngest } from "@/modules/amazon/marketing-stream-handlers";
import { runWhatsappEstoqueResumo } from "@/modules/whatsapp-estoque/jobs";
import { StatusAmazonSyncJob, TipoAmazonSyncJob } from "@/modules/shared/domain";

const HEARTBEAT_KEY = "worker_heartbeat_at";
const STALE_RUNNING_JOB_MINUTES = Number(
  process.env.AMAZON_RUNNING_JOB_STALE_MINUTES ?? 30,
);

type WorkerOptions = {
  workerId?: string;
  limit?: number;
  schedule?: boolean;
};

type SyncPayload = {
  orderIds?: string[];
  diasAtras?: number;
  maxPages?: number;
  windowDias?: number;
  windowHoras?: number;
  dateFilter?: "created" | "lastUpdated";
  cursorKey?: string;
  overlapMinutes?: number;
  notificationId?: string;
  eventTime?: string;
  // Marketing Stream ingest (AMAZON_ADS_STREAM_INGEST)
  records?: unknown[];
  dataset?: string;
  profileId?: string;
  dedupeKey?: string;
};

// Empresa do worker (single-tenant por ora). A extensao de isolamento (db.ts)
// usa este contexto quando TENANT_ISOLATION=enforce; em "off" e inocuo. Vira
// per-AmazonAccount quando o worker iterar contas.
const WORKER_EMPRESA_ID = process.env.WORKER_EMPRESA_ID || "mundofs";

// Contexto de manutenção global (sem filtro de tenant): usado para operações de
// fila keyed por id único (claim/complete/fail/release) e adoção de órfãos.
const SUPERADMIN_WORKER = {
  empresaId: null,
  isSuperAdmin: true,
  source: "worker" as const,
};

export async function processAmazonSyncJobs(options: WorkerOptions = {}) {
  return processAmazonSyncJobsInner(options);
}

async function processAmazonSyncJobsInner(options: WorkerOptions = {}) {
  const workerId = options.workerId ?? `worker-${process.pid}-${Date.now()}`;
  const limit = options.limit ?? 10;
  const results: Array<Record<string, unknown>> = [];

  // Manutenção global sob superadmin (sem filtro): adota jobs órfãos (empresaId
  // null — legados/SQS) para a empresa primária e libera RUNNING presos de todas.
  await runWithTenant(SUPERADMIN_WORKER, async () => {
    await adoptOrphanJobs();
    await releaseStaleRunningJobs(workerId);
  });

  // Agendamento recorrente: por conta Amazon ATIVA (cada uma sob seu tenant).
  if (options.schedule !== false) {
    await ensureRecurringAmazonJobs();
  }

  // Drena a fila por prioridade (claim global sob superadmin) e processa cada job
  // sob o tenant do PRÓPRIO job (job.empresaId) — credenciais resolvidas por conta.
  for (let i = 0; i < limit; i += 1) {
    const job = await runWithTenant(SUPERADMIN_WORKER, () =>
      claimNextAmazonSyncJob(workerId),
    );
    if (!job) break;

    const empresaId = job.empresaId ?? WORKER_EMPRESA_ID;
    const jobTenant = { empresaId, isSuperAdmin: false, source: "worker" as const };

    try {
      const result = await runWithTenant(jobTenant, () =>
        processJob(job.tipo, job.payload),
      );
      await runWithTenant(SUPERADMIN_WORKER, () =>
        completeAmazonSyncJob(job.id, result),
      );
      results.push({ jobId: job.id, tipo: job.tipo, empresaId, status: "SUCCESS", result });
    } catch (error) {
      const retryAt = getRetryAt(error);
      const message = error instanceof Error ? error.message : String(error);
      await runWithTenant(SUPERADMIN_WORKER, () =>
        failAmazonSyncJob({
          jobId: job.id,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          error: message,
          runAfter: retryAt,
        }),
      );

      // Notificacao no sino do ERP quando job esgota tentativas (Notificacao é
      // TENANT — registra sob o tenant da empresa dona do job).
      if (job.attempts >= job.maxAttempts && !retryAt) {
        try {
          await runWithTenant(jobTenant, () =>
            notificarJobFalhando({
              jobId: job.id,
              tipo: job.tipo,
              attempts: job.attempts,
              error: message,
            }),
          );
        } catch {
          // Nunca propaga erro de notificacao.
        }
      }

      results.push({
        jobId: job.id,
        tipo: job.tipo,
        empresaId,
        status: retryAt ? "RETRY" : "FAILED",
        error: message,
        runAfter: retryAt?.toISOString(),
      });
    }
  }

  // Heartbeat: outras partes do sistema (health endpoint, watchdog) usam isso
  // para detectar worker travado. ConfiguracaoSistema é GLOBAL — sem tenant.
  await writeHeartbeat();

  // SQS + reconciliação sob a empresa primária (single-tenant por ora).
  // SQS drena notificações push do SP-API; reconciliação Nubank ↔ ContaReceber.
  await runWithTenant(
    { empresaId: WORKER_EMPRESA_ID, isSuperAdmin: false, source: "worker" },
    async () => {
      try {
        await pollSqsNotifications({ maxMessages: 10, waitTimeSeconds: 1 });
      } catch (e) {
        console.warn("pollSqsNotifications erro:", e);
      }
      try {
        await reconciliarRecebimentosAmazon();
      } catch (e) {
        console.warn("reconciliarRecebimentosAmazon erro:", e);
      }
    },
  );

  return { processed: results.length, results };
}

// Adota jobs órfãos (empresaId null — enfileirados por SQS/rotas/legado antes do
// F02) para a empresa primária, para que o claim por tenant os alcance. Roda sob
// superadmin (sem filtro). No-op após o primeiro loop (nada mais fica null).
async function adoptOrphanJobs() {
  try {
    await db.amazonSyncJob.updateMany({
      where: { empresaId: null },
      data: { empresaId: WORKER_EMPRESA_ID },
    });
  } catch (e) {
    console.warn("adoptOrphanJobs erro:", e);
  }
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

async function releaseStaleRunningJobs(workerId: string) {
  const staleMinutes = Number.isFinite(STALE_RUNNING_JOB_MINUTES)
    ? Math.max(5, STALE_RUNNING_JOB_MINUTES)
    : 30;
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  try {
    const result = await db.amazonSyncJob.updateMany({
      where: {
        status: StatusAmazonSyncJob.RUNNING,
        OR: [
          { lockedAt: { lt: cutoff } },
          { startedAt: { lt: cutoff } },
        ],
      },
      data: {
        status: StatusAmazonSyncJob.QUEUED,
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        finishedAt: null,
        runAfter: new Date(),
        error: `Auto-released stale RUNNING job by ${workerId}`,
      },
    });

    if (result.count > 0) {
      console.warn(
        `[amazon-worker] liberou ${result.count} job(s) RUNNING antigo(s).`,
      );
    }
  } catch (error) {
    console.warn("releaseStaleRunningJobs erro:", error);
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
  // AMAZON_ADS_STREAM_INGEST processa payload local — nao precisa de creds.
  const needCreds =
    !isAdsJob &&
    tipo !== TipoAmazonSyncJob.REVIEWS_DISCOVERY &&
    tipo !== TipoAmazonSyncJob.REVIEWS_SEND &&
    tipo !== TipoAmazonSyncJob.AMAZON_ADS_STREAM_INGEST &&
    tipo !== TipoAmazonSyncJob.WHATSAPP_ESTOQUE_RESUMO;

  // F02: resolve as credenciais SP-API pela CONTA da empresa do contexto (grant
  // OAuth cifrado por seller). Fallback para a config global enquanto a conta não
  // foi conectada via OAuth (transição / single-tenant legado).
  let sp: SPAPICredentials | null = null;
  if (needCreds) {
    const empresaId = getEmpresaId();
    if (empresaId) {
      try {
        sp = await resolverCredenciaisDaConta(empresaId);
      } catch {
        sp = null; // conta não conectada → tenta a config global abaixo
      }
    }
    if (!sp) {
      const config = await getAmazonConfig();
      if (!isAmazonConfigured(config)) {
        return {
          ok: false,
          skipped: true,
          mensagem: "Credenciais Amazon nao configuradas — job pulado.",
        };
      }
      sp = {
        clientId: config.amazon_client_id!,
        clientSecret: config.amazon_client_secret!,
        refreshToken: config.amazon_refresh_token!,
        marketplaceId: config.amazon_marketplace_id!,
        endpoint: config.amazon_endpoint || undefined,
      };
    }
  }

  switch (tipo) {
    case TipoAmazonSyncJob.ORDERS_SYNC:
      return syncOrders(payload.diasAtras ?? 3, {
        maxPages: payload.maxPages ?? 1,
        orderIds: payload.orderIds,
        since: payload.windowDias ? subDays(new Date(), payload.windowDias) : undefined,
        windowHoras: payload.windowHoras,
        dateFilter: payload.dateFilter,
        cursorKey: payload.cursorKey,
        overlapMinutes: payload.overlapMinutes,
      });
    case TipoAmazonSyncJob.FINANCES_SYNC:
      return syncFinances(payload.diasAtras ?? 14, {
        maxPages: payload.maxPages ?? 1,
      });
    case TipoAmazonSyncJob.REFUNDS_SYNC:
      return syncRefunds(payload.diasAtras ?? 90, {
        maxPages: payload.maxPages ?? 20,
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
      const adsCreds = await getAmazonAdsCredentials({ requireProfile: true });
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
    case TipoAmazonSyncJob.AMAZON_ADS_STREAM_INGEST:
      return runMarketingStreamIngest(payload);
    case TipoAmazonSyncJob.AMAZON_ADS_BACKFILL: {
      const adsCreds = await getAmazonAdsCredentials({ requireProfile: true });
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
    case TipoAmazonSyncJob.LISTING_PRICE_SYNC:
      return runListingPriceSync(sp!);
    case TipoAmazonSyncJob.AMAZON_FEE_ESTIMATE_SYNC:
      return runAmazonFeeEstimateSync(sp!);
    case TipoAmazonSyncJob.AMAZON_FBA_PROMO_EXPIRY_CHECK:
      return runAmazonFbaPromoExpiryCheck();
    case TipoAmazonSyncJob.WHATSAPP_ESTOQUE_RESUMO:
      return runWhatsappEstoqueResumo({ tipo: "DIARIO" });
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
