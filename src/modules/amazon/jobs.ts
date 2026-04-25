import { db } from "@/lib/db";
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
};

const OPEN_JOB_STATUSES = [
  StatusAmazonSyncJob.QUEUED,
  StatusAmazonSyncJob.RUNNING,
] as const;

const SCHEDULES: Array<{
  tipo: TipoAmazonSyncJobType;
  intervalMs: number;
  priority: number;
  payload?: Record<string, unknown>;
}> = [
  {
    tipo: TipoAmazonSyncJob.ORDERS_SYNC,
    intervalMs: 15 * 60_000,
    priority: 30,
    payload: { diasAtras: 3, maxPages: 1 },
  },
  {
    tipo: TipoAmazonSyncJob.INVENTORY_SYNC,
    intervalMs: 30 * 60_000,
    priority: 20,
  },
  {
    tipo: TipoAmazonSyncJob.FINANCES_SYNC,
    intervalMs: 2 * 60 * 60_000,
    priority: 10,
    payload: { diasAtras: 14, maxPages: 1 },
  },
  {
    tipo: TipoAmazonSyncJob.REFUNDS_SYNC,
    intervalMs: 2 * 60 * 60_000,
    priority: 10,
    payload: { diasAtras: 90, maxPages: 1 },
  },
  {
    tipo: TipoAmazonSyncJob.REVIEWS_DISCOVERY,
    intervalMs: 6 * 60 * 60_000,
    priority: 40,
  },
  {
    tipo: TipoAmazonSyncJob.REVIEWS_SEND,
    intervalMs: 60 * 60_000,
    priority: 35,
  },
];

export async function enqueueAmazonSyncJob(
  tipo: TipoAmazonSyncJobType,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
) {
  const dedupeKey = options.dedupeKey;

  if (dedupeKey) {
    const existing = await db.amazonSyncJob.findFirst({
      where: {
        dedupeKey,
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
      status: StatusAmazonSyncJob.QUEUED,
      priority: options.priority ?? 0,
      payload: JSON.stringify(payload),
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
      result: JSON.stringify(result),
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

export async function ensureRecurringAmazonJobs(now = new Date()) {
  const created = [];

  for (const schedule of SCHEDULES) {
    const slot = Math.floor(now.getTime() / schedule.intervalMs);
    const dedupeKey = `${schedule.tipo}:${slot}`;
    const job = await enqueueAmazonSyncJob(
      schedule.tipo,
      schedule.payload ?? {},
      {
        dedupeKey,
        dedupeAnyStatus: true,
        priority: schedule.priority,
      },
    );
    created.push(job);
  }

  return created;
}

export function parseJobPayload<T extends Record<string, unknown>>(
  payload: string | null,
): T {
  if (!payload) return {} as T;
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
