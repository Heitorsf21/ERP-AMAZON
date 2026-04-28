import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEARTBEAT_KEY = "worker_heartbeat_at";
const INTERNAL_TOKEN_HEADER = "x-internal-health-token";

type SyncSnapshot = {
  tipo: string;
  status: string;
  registros: number;
  createdAt: string;
};

function isInternalTokenValid(received: string | null): boolean {
  const expected = process.env.INTERNAL_HEALTH_TOKEN;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const inicio = Date.now();

  const dbCheck = await db.$queryRaw`SELECT 1 as ok`
    .then(() => ({ ok: true as const, error: null as string | null }))
    .catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));

  // Se o banco caiu, devolve 503 sem mais consultas.
  if (!dbCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        db: dbCheck,
        version: process.env.GIT_SHA ?? "dev",
        elapsedMs: Date.now() - inicio,
      },
      { status: 503 },
    );
  }

  const [heartbeatRow, quotas, queueCounts, lastLogs] = await Promise.all([
    db.configuracaoSistema.findUnique({ where: { chave: HEARTBEAT_KEY } }),
    db.amazonApiQuota.findMany({
      orderBy: { operation: "asc" },
      select: {
        operation: true,
        nextAllowedAt: true,
        rateLimitPerSecond: true,
        observedRps: true,
        lastStatus: true,
      },
    }),
    db.amazonSyncJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.amazonSyncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        tipo: true,
        status: true,
        registros: true,
        createdAt: true,
      },
    }),
  ]);

  const lastByTipo = new Map<string, SyncSnapshot>();
  for (const log of lastLogs) {
    const existing = lastByTipo.get(log.tipo);
    if (!existing || existing.createdAt < log.createdAt.toISOString()) {
      lastByTipo.set(log.tipo, {
        tipo: log.tipo,
        status: log.status,
        registros: log.registros,
        createdAt: log.createdAt.toISOString(),
      });
    }
  }

  const heartbeatAt = heartbeatRow?.valor ? new Date(heartbeatRow.valor) : null;
  const ageSec = heartbeatAt ? Math.floor((Date.now() - heartbeatAt.getTime()) / 1000) : null;
  const workerOk = ageSec !== null && ageSec <= 300;

  const internalTokenOk = isInternalTokenValid(
    request.headers.get(INTERNAL_TOKEN_HEADER),
  );
  const session = internalTokenOk ? null : await getSession();
  const canSeeDetails = internalTokenOk || session?.role === "ADMIN";

  if (!canSeeDetails) {
    return NextResponse.json({
      ok: dbCheck.ok && workerOk,
      version: process.env.GIT_SHA ?? "dev",
      elapsedMs: Date.now() - inicio,
    });
  }

  const cooldowns = quotas
    .filter((q) => q.nextAllowedAt && q.nextAllowedAt > new Date())
    .map((q) => ({
      operation: q.operation,
      nextAllowedAt: q.nextAllowedAt?.toISOString(),
    }));

  const queueByStatus = Object.fromEntries(
    queueCounts.map((row) => [row.status, row._count._all]),
  );

  return NextResponse.json({
    ok: dbCheck.ok && workerOk,
    db: dbCheck,
    worker: {
      lastHeartbeatAt: heartbeatAt?.toISOString() ?? null,
      ageSec,
      ok: workerOk,
    },
    queue: queueByStatus,
    quota: {
      total: quotas.length,
      cooldowns,
    },
    lastSync: Object.fromEntries(lastByTipo),
    version: process.env.GIT_SHA ?? "dev",
    elapsedMs: Date.now() - inicio,
  });
}
