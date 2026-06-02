import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/tenant-context";
import { TIMEZONE } from "@/lib/date";
import { getReviewAutomationConfig } from "@/modules/amazon/service";
import { getWhatsappEstoqueScheduleConfig } from "@/modules/whatsapp-estoque/config";
import {
  StatusAmazonSyncJob,
  TipoAmazonSyncJob,
  type TipoAmazonSyncJob as TipoAmazonSyncJobType,
} from "@/modules/shared/domain";

type EnqueueOptions = {
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
  dedupeKey?: string;
  dedupeAnyStatus?: boolean;
  // F02: empresa dona do job (multi-seller). null = legado/global (adotado pela
  // empresa primária no worker). Setado explicitamente para funcionar tanto em
  // TENANT_ISOLATION=off quanto enforce (a extensão só injeta quando ausente).
  empresaId?: string | null;
};

// Empresa de background (single-tenant fallback). Mesma chave do worker/tenant-context.
const WORKER_EMPRESA_ID = process.env.WORKER_EMPRESA_ID || "mundofs";

const OPEN_JOB_STATUSES = [
  StatusAmazonSyncJob.QUEUED,
  StatusAmazonSyncJob.RUNNING,
] as const;

const SQS_PRIMARY =
  process.env.AMAZON_SQS_PRIMARY === "true" && !!process.env.AMAZON_SQS_QUEUE_URL;

function encodeJobJson(value: Record<string, unknown>) {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  return databaseUrl.startsWith("postgres") ? value : JSON.stringify(value);
}

// Intervalos otimizados para respeitar quota real observada da SP-API.
// ORDERS usa passagens separadas (created e lastUpdated) para nao fazer
// duas ORDERS_SEARCH dentro do mesmo minuto.
// INVENTORY fica mais conservador quando SQS e a fonte primaria.
// FINANCES aceita 0.5 rps — 30min preserva quota e é frequente.
// Gate de AMAZON_FEE_ESTIMATE_SYNC: pula execução quando PRODUCT_FEES_ESTIMATE
// está em cooldown profundo (>5min). Evita enfileirar jobs vazios quando a
// quota Amazon está saturada. Recupera natural quando o cooldown limpa.
async function isProductFeesQuotaSaturated(): Promise<boolean> {
  try {
    const { getAmazonOperationCooldown, AmazonSpApiOperation } = await import(
      "@/lib/amazon-rate-limit"
    );
    const cooldownAte = await getAmazonOperationCooldown(
      AmazonSpApiOperation.PRODUCT_FEES_ESTIMATE,
    );
    if (!cooldownAte) return false;
    const ms = cooldownAte.getTime() - Date.now();
    return ms > 5 * 60_000;
  } catch {
    return false;
  }
}

async function isReportsApiBusy(): Promise<boolean> {
  try {
    const { getAmazonOperationCooldown, AmazonSpApiOperation } = await import(
      "@/lib/amazon-rate-limit"
    );
    const operations = [
      AmazonSpApiOperation.REPORTS_GET,
      AmazonSpApiOperation.REPORTS_GET_BY_ID,
      AmazonSpApiOperation.REPORTS_GET_DOCUMENT,
      AmazonSpApiOperation.REPORTS_CREATE,
    ];
    const now = Date.now();
    for (const operation of operations) {
      const cooldownAte = await getAmazonOperationCooldown(operation);
      if (cooldownAte && cooldownAte.getTime() > now + 5_000) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const FINANCES_BACKFILL_CURSOR_KEY_INTERNAL = "amazon_finances_backfill_cursor";
// Janela coberta pelo FINANCES_SYNC (14d). Quando o cursor do backfill cruza
// essa fronteira, o sync recorrente cobre tudo a partir dali — backfill vira
// redundante. Usamos 13d (margem de 1d) para evitar oscilação no limite.
const FINANCES_SYNC_COVERAGE_DAYS = 13;

// Gate: bloqueia enfileiramento de FINANCES_BACKFILL quando cursor já entrou
// na janela do FINANCES_SYNC. Defesa em profundidade — se cursor regredir
// (reset manual via scripts/force-finances-backfill.ts), backfill volta sozinho.
async function isFinancesBackfillComplete(): Promise<boolean> {
  const cfg = await db.configuracaoSistema.findUnique({
    where: { chave: FINANCES_BACKFILL_CURSOR_KEY_INTERNAL },
  });
  if (!cfg?.valor) return false;
  const cursor = new Date(cfg.valor);
  if (!Number.isFinite(cursor.getTime())) return false;
  const syncCoverageStart = new Date(
    Date.now() - FINANCES_SYNC_COVERAGE_DAYS * 86400_000,
  );
  return cursor >= syncCoverageStart;
}

// Data local (America/Sao_Paulo) em yyyy-MM-dd — usada como dedupe diario.
function dataLocalSP(now: Date): string {
  return format(toZonedTime(now, TIMEZONE), "yyyy-MM-dd");
}

// Gate do resumo diario de estoque: pula enquanto estiver desativado ou o
// horario local atual ainda nao alcancou o horario configurado. Comparacao
// lexicografica de "HH:mm" funciona pois ambos sao zero-padded.
async function isWhatsappEstoqueResumoSkip(): Promise<boolean> {
  try {
    const { ativo, horario } = await getWhatsappEstoqueScheduleConfig();
    if (!ativo) return true;
    const agoraLocal = format(toZonedTime(new Date(), TIMEZONE), "HH:mm");
    return agoraLocal < horario;
  } catch {
    return true;
  }
}

const SCHEDULES: Array<{
  tipo: TipoAmazonSyncJobType;
  intervalMs: number;
  priority: number;
  payload?: Record<string, unknown>;
  gate?: () => Promise<boolean>;
  runAfterOffsetMs?: number;
  // Quando presente, substitui o dedupeKey baseado em slot por uma chave
  // customizada (ex: dedupe por data local em vez de janela fixa).
  dedupeKeyOverride?: (now: Date) => string;
}> = [
  {
    tipo: TipoAmazonSyncJob.ORDERS_SYNC,
    intervalMs: SQS_PRIMARY ? 15 * 60_000 : 2 * 60_000,
    priority: 30,
    payload: { diasAtras: 3, maxPages: 1, dateFilter: "created" },
  },
  {
    tipo: TipoAmazonSyncJob.ORDERS_SYNC,
    intervalMs: SQS_PRIMARY ? 15 * 60_000 : 5 * 60_000,
    priority: 25,
    payload: {
      dateFilter: "lastUpdated",
      windowHoras: 6,
      maxPages: 1,
      cursorKey: "amazon_orders_last_updated_cursor",
    },
    runAfterOffsetMs: 70_000,
    dedupeKeyOverride: (now) =>
      `${TipoAmazonSyncJob.ORDERS_SYNC}:lastUpdated:${Math.floor(
        now.getTime() / (SQS_PRIMARY ? 15 * 60_000 : 5 * 60_000),
      )}`,
  },
  {
    tipo: TipoAmazonSyncJob.INVENTORY_SYNC,
    intervalMs: SQS_PRIMARY ? 15 * 60_000 : 2 * 60_000,
    priority: 20,
  },
  {
    tipo: TipoAmazonSyncJob.FINANCES_SYNC,
    intervalMs: 15 * 60_000,
    priority: 10,
    payload: { diasAtras: 14, maxPages: 1 },
  },
  {
    tipo: TipoAmazonSyncJob.REFUNDS_SYNC,
    intervalMs: 30 * 60_000,
    priority: 10,
    payload: { diasAtras: 90, maxPages: 20 },
  },
  {
    tipo: TipoAmazonSyncJob.REVIEWS_DISCOVERY,
    intervalMs: 12 * 60 * 60_000,
    priority: 40,
  },
  {
    tipo: TipoAmazonSyncJob.REVIEWS_SEND,
    intervalMs: 60 * 60_000,
    priority: 35,
  },
  {
    tipo: TipoAmazonSyncJob.SETTLEMENT_REPORT_SYNC,
    intervalMs: 6 * 60 * 60_000,
    priority: 25,
    gate: isReportsApiBusy,
  },
  {
    // Backfill de pedidos via Reports API. Cada execução cria/processa UMA janela
    // de 30d. Auto-no-op quando o cursor alcança now-2d. Roda a cada 30min para
    // dar tempo ao Amazon processar os reports (que costumam levar 5-10min).
    tipo: TipoAmazonSyncJob.REPORTS_BACKFILL,
    intervalMs: 30 * 60_000,
    priority: 5,
    gate: isReportsApiBusy,
  },
  {
    tipo: TipoAmazonSyncJob.BUYBOX_CHECK,
    intervalMs: 10 * 60_000,
    priority: 15,
  },
  {
    tipo: TipoAmazonSyncJob.CATALOG_REFRESH,
    intervalMs: 24 * 60 * 60_000,
    priority: 5,
  },
  // ── Sprint 2: backfill que sustenta a DRE ──
  // Cada execução processa 1 janela e avança cursor; auto-desliga ao
  // alcançar `now - 2 dias`. Prioridade baixa (5) para não competir com
  // jobs operacionais. Gate evita enfileirar jobs vazios quando cursor já
  // está em now-2d (auto-no-op de fila, não só do handler).
  {
    tipo: TipoAmazonSyncJob.FINANCES_BACKFILL,
    intervalMs: 30 * 60_000,
    priority: 5,
    gate: async () => (await isFinancesBackfillComplete()) || (await isReportsApiBusy()),
  },
  {
    tipo: TipoAmazonSyncJob.SETTLEMENT_BACKFILL,
    intervalMs: 24 * 60 * 60_000,
    priority: 5,
    gate: isReportsApiBusy,
  },
  {
    // Snapshot diário de inventário FBA. Histórico não volta pela API,
    // a série temporal começa no dia em que este job rodar pela 1ª vez.
    tipo: TipoAmazonSyncJob.INVENTORY_SNAPSHOT,
    intervalMs: 24 * 60 * 60_000,
    priority: 5,
  },
  // Sprint 3: reports financeiros diretos.
  {
    tipo: TipoAmazonSyncJob.FBA_REIMBURSEMENTS_SYNC,
    intervalMs: 12 * 60 * 60_000,
    priority: 12,
    payload: { diasAtras: 90 },
    gate: isReportsApiBusy,
  },
  {
    tipo: TipoAmazonSyncJob.RETURNS_SYNC,
    intervalMs: 6 * 60 * 60_000,
    priority: 11,
    payload: { diasAtras: 90 },
    gate: isReportsApiBusy,
  },
  {
    tipo: TipoAmazonSyncJob.FBA_STORAGE_SYNC,
    intervalMs: 24 * 60 * 60_000,
    priority: 6,
    gate: isReportsApiBusy,
  },
  {
    tipo: TipoAmazonSyncJob.TRAFFIC_SYNC,
    intervalMs: 24 * 60 * 60_000,
    priority: 6,
    payload: { diasAtras: 30 },
    gate: isReportsApiBusy,
  },
  // Sprint 5.5: Amazon Advertising (Sponsored Products).
  // Lifecycle progressivo: cada execucao ou cria um report novo ou avanca o
  // pending (poll/download). Polling em 30min eh seguro: ADS_REPORTS_GET aceita
  // 5 rps e o report normalmente fica COMPLETED em 5-15min. Reports da Ads API
  // sao gratuitos, entao nao ha custo em recriar a janela trailing.
  {
    tipo: TipoAmazonSyncJob.AMAZON_ADS_REPORT_SYNC,
    intervalMs: 60 * 60_000,
    priority: 12,
    payload: { diasAtras: 30 },
  },
  // Backfill de ate ~90 dias por execucao (limite Ads API), avancando cursor.
  // 365d / 90d/janela = 5 ciclos. A 30min/ciclo, ~2.5h cobre o ano todo.
  {
    tipo: TipoAmazonSyncJob.AMAZON_ADS_BACKFILL,
    intervalMs: 15 * 60_000,
    priority: 4,
  },
  // Cache do our_price (Listings Items API). Roda a cada 30min para preencher
  // Produto.amazonPrecoListagemCentavos — usado como fallback quando pedidos
  // Pending vem sem ItemPrice da Orders API. Rate limit LISTINGS_GET_ITEM = 5 rps.
  {
    tipo: TipoAmazonSyncJob.LISTING_PRICE_SYNC,
    intervalMs: 30 * 60_000,
    priority: 8,
  },
  // Estimator de taxas (comissão+FBA) via SP-API getMyFeesEstimateForSKU.
  // Amazon enforces quota agressiva — batch=5 SKUs/exec × 1h = 120 SKUs/dia.
  // Refresh por SKU acontece a cada ~20h (filtro limiteRecente no handler).
  // Gate: pula execução se quota PRODUCT_FEES_ESTIMATE em cooldown >5min.
  {
    tipo: TipoAmazonSyncJob.AMAZON_FEE_ESTIMATE_SYNC,
    intervalMs: 60 * 60_000,
    priority: 7,
    gate: isProductFeesQuotaSaturated,
  },
  // Verifica diariamente se a promo FBA (R$5/R$0) expirou — dispara Notificacao.
  {
    tipo: TipoAmazonSyncJob.AMAZON_FBA_PROMO_EXPIRY_CHECK,
    intervalMs: 24 * 60 * 60_000,
    priority: 5,
  },
  // Resumo diario de estoque via WhatsApp. O scheduler por intervalo nao garante
  // 10:00 local, entao usamos um gate por horario local + dedupe por data local
  // (so um envio por dia). intervalMs curto so para reavaliar o gate com frequencia.
  {
    tipo: TipoAmazonSyncJob.WHATSAPP_ESTOQUE_RESUMO,
    intervalMs: 5 * 60_000,
    priority: 5,
    gate: isWhatsappEstoqueResumoSkip,
    dedupeKeyOverride: (now) =>
      `${TipoAmazonSyncJob.WHATSAPP_ESTOQUE_RESUMO}:${dataLocalSP(now)}`,
  },
];

export async function enqueueAmazonSyncJob(
  tipo: TipoAmazonSyncJobType,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
) {
  const dedupeKey = options.dedupeKey;
  const empresaId = options.empresaId ?? null;

  if (dedupeKey) {
    const existing = await db.amazonSyncJob.findFirst({
      where: {
        dedupeKey,
        empresaId,
        ...(options.dedupeAnyStatus
          ? {}
          : { status: { in: [...OPEN_JOB_STATUSES] } }),
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
  }

  return db.amazonSyncJob.create({
    data: {
      tipo,
      empresaId,
      status: StatusAmazonSyncJob.QUEUED,
      priority: options.priority ?? 0,
      payload: encodeJobJson(payload) as never,
      runAfter: options.runAfter ?? new Date(),
      maxAttempts: options.maxAttempts ?? 5,
      dedupeKey,
    },
  });
}

export async function getAmazonSyncJobs(limit = 50) {
  return db.amazonSyncJob.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });
}

export async function getAmazonSyncQueueSummary() {
  const [queued, running, failed, lastJobs] = await Promise.all([
    db.amazonSyncJob.count({ where: { status: StatusAmazonSyncJob.QUEUED } }),
    db.amazonSyncJob.count({ where: { status: StatusAmazonSyncJob.RUNNING } }),
    db.amazonSyncJob.count({ where: { status: StatusAmazonSyncJob.FAILED } }),
    getAmazonSyncJobs(20),
  ]);

  return { queued, running, failed, lastJobs };
}

// Claim com optimistic lock: pega o job de maior prioridade pronto e
// marca como RUNNING via updateMany com filtro de status (evita race se 2 workers
// pegarem o mesmo). No Postgres real, trocamos isso por SELECT FOR UPDATE SKIP LOCKED
// (versão em prisma/schema.postgresql.prisma + jobs commitada para futuro).
export async function claimNextAmazonSyncJob(workerId: string) {
  const now = new Date();
  const job = await db.amazonSyncJob.findFirst({
    where: {
      status: StatusAmazonSyncJob.QUEUED,
      runAfter: { lte: now },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  if (!job) return null;

  const claimed = await db.amazonSyncJob.updateMany({
    where: { id: job.id, status: StatusAmazonSyncJob.QUEUED },
    data: {
      status: StatusAmazonSyncJob.RUNNING,
      attempts: { increment: 1 },
      startedAt: now,
      lockedAt: now,
      lockedBy: workerId,
      error: null,
    },
  });

  if (claimed.count === 0) return null;
  return db.amazonSyncJob.findUnique({ where: { id: job.id } });
}

export async function completeAmazonSyncJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  return db.amazonSyncJob.update({
    where: { id: jobId },
    data: {
      status: StatusAmazonSyncJob.SUCCESS,
      result: encodeJobJson(result) as never,
      error: null,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

export async function failAmazonSyncJob({
  jobId,
  attempts,
  maxAttempts,
  error,
  runAfter,
}: {
  jobId: string;
  attempts: number;
  maxAttempts: number;
  error: string;
  runAfter?: Date;
}) {
  const shouldRetry = attempts < maxAttempts;
  return db.amazonSyncJob.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? StatusAmazonSyncJob.QUEUED : StatusAmazonSyncJob.FAILED,
      error,
      runAfter: shouldRetry ? runAfter ?? defaultRetryAt(attempts) : new Date(),
      finishedAt: shouldRetry ? null : new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

// Cache curto (30s) do toggle master de reviews — `ensureRecurringAmazonJobs`
// roda a cada loop do worker (~30s default). Sem cache seria 1 SELECT por loop.
let reviewToggleCache: { value: boolean; at: number } | null = null;
const REVIEW_TOGGLE_CACHE_TTL_MS = 30_000;

export function invalidateReviewToggleCache() {
  reviewToggleCache = null;
}

async function getReviewAutomacaoAtivaCached(now: number): Promise<boolean> {
  if (reviewToggleCache && now - reviewToggleCache.at < REVIEW_TOGGLE_CACHE_TTL_MS) {
    return reviewToggleCache.value;
  }
  const value = await getReviewAutomationConfig()
    .then((c) => c.automacaoAtiva)
    .catch(() => true);
  reviewToggleCache = { value, at: now };
  return value;
}

/**
 * Empresas para as quais agendar jobs recorrentes (F02 multi-seller): contas
 * Amazon conectadas (ATIVA + refreshTokenEnc). AmazonAccount é GLOBAL_MODEL, então
 * a leitura não é filtrada por tenant. Sem nenhuma conta conectada, cai no
 * fallback single-tenant (empresa primária usando a config global de credenciais).
 */
async function empresaIdsParaAgendar(): Promise<string[]> {
  const contas = await db.amazonAccount.findMany({
    where: { ativa: true, status: "ATIVA", refreshTokenEnc: { not: null } },
    select: { empresaId: true },
  });
  const ids = [...new Set(contas.map((c) => c.empresaId))];
  return ids.length > 0 ? ids : [WORKER_EMPRESA_ID];
}

export async function ensureRecurringAmazonJobs(now = new Date()) {
  const created: unknown[] = [];
  for (const empresaId of await empresaIdsParaAgendar()) {
    // Cada empresa agenda sob seu próprio contexto de tenant — os gates que leem
    // modelos TENANT (ex: AmazonApiQuota) ficam escopados à empresa em enforce.
    const lote = await runWithTenant(
      { empresaId, isSuperAdmin: false, source: "worker" },
      () => agendarRecorrentesDaEmpresa(empresaId, now),
    );
    created.push(...lote);
  }
  return created;
}

async function agendarRecorrentesDaEmpresa(empresaId: string, now: Date) {
  const created = [];

  // Toggle master da automação de reviews. Se desativado, não enfileiramos
  // REVIEWS_DISCOVERY/SEND para manter a fila limpa (os handlers também têm
  // a checagem como defesa em profundidade).
  const reviewAutomacaoAtiva = await getReviewAutomacaoAtivaCached(now.getTime());

  for (const schedule of SCHEDULES) {
    if (
      !reviewAutomacaoAtiva &&
      (schedule.tipo === TipoAmazonSyncJob.REVIEWS_DISCOVERY ||
        schedule.tipo === TipoAmazonSyncJob.REVIEWS_SEND)
    ) {
      continue;
    }

    if (schedule.gate) {
      const skip = await schedule.gate().catch(() => false);
      if (skip) continue;
    }

    const dedupeBase = schedule.dedupeKeyOverride
      ? schedule.dedupeKeyOverride(now)
      : `${schedule.tipo}:${Math.floor(now.getTime() / schedule.intervalMs)}`;
    // Prefixo por empresa: evita colisão de dedupe entre sellers (cada um agenda
    // o mesmo tipo no mesmo slot).
    const dedupeKey = `${empresaId}:${dedupeBase}`;
    const runAfter = schedule.runAfterOffsetMs
      ? new Date(now.getTime() + schedule.runAfterOffsetMs)
      : undefined;
    const job = await enqueueAmazonSyncJob(
      schedule.tipo,
      schedule.payload ?? {},
      {
        dedupeKey,
        dedupeAnyStatus: true,
        priority: schedule.priority,
        runAfter,
        empresaId,
      },
    );
    created.push(job);
  }

  return created;
}

// Payloads antigos podem estar como string JSON; novos registros usam Json/jsonb real.
export function parseJobPayload<T extends Record<string, unknown>>(
  payload: unknown,
): T {
  if (!payload) return {} as T;
  if (typeof payload === "object") return payload as T;
  if (typeof payload !== "string") return {} as T;
  try {
    return JSON.parse(payload) as T;
  } catch {
    return {} as T;
  }
}

function defaultRetryAt(attempts: number) {
  const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs);
}
