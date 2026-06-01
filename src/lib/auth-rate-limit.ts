import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Janela de 15min. Limite de 8 falhas por (IP, email) antes de bloquear.
// Persiste em Postgres (model LoginThrottle) para sobreviver restart do PM2
// e funcionar com multiplas instancias futuras.
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_FAILURE_MAX = 8;

export type LoginFailureResult = {
  limited: boolean;
  count: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export function getLoginFailureKey(headers: Headers, email: string): string {
  const normalizedEmail = email.toLowerCase().trim() || "unknown";
  return `${getClientIp(headers)}:${normalizedEmail}`;
}

// Chave por (ip, slug, email) para o login multiempresa.
// TRADEOFF CONHECIDO (aceito na escala atual — poucas empresas): incluir o slug
// na chave permite, em tese, contornar o limite por-email variando o slug
// (N slugs => N*limite tentativas para o mesmo email). Mitigado porque o slug
// precisa ser de uma empresa REAL (slug invalido cai em ":unknownslug:" e gasta
// tentativa). Quando o numero de tenants crescer, considerar uma 2a camada de
// throttle por (ip, email) agregando todos os slugs. Ver plano A+B (Task 11).
export function getLoginFailureKeyComEmpresa(headers: Headers, slug: string, email: string): string {
  const e = email.toLowerCase().trim() || "unknown";
  const s = slug.toLowerCase().trim() || "unknown";
  return `${getClientIp(headers)}:${s}:${e}`;
}

/**
 * Registra uma falha de login. Atomic upsert renova `resetAt` se a janela
 * anterior expirou, mantem-na caso contrario, e incrementa count em todo
 * cenario.
 *
 * Fail-open: se o DB estiver indisponivel, libera (mas loga). DB caido
 * ja vai derrubar o login mesmo, entao bloquear duas vezes nao agrega.
 */
export async function recordLoginFailureByKey(
  chave: string,
  now = Date.now(),
): Promise<LoginFailureResult> {
  const nowDate = new Date(now);
  const newResetAt = new Date(now + LOGIN_FAILURE_WINDOW_MS);

  try {
    // 1. busca o registro atual (pode nao existir).
    const atual = await db.loginThrottle.findUnique({ where: { chave } });

    // 2. se nao existe OU janela expirou, comeca um novo bucket.
    if (!atual || atual.resetAt.getTime() <= now) {
      const criado = await db.loginThrottle.upsert({
        where: { chave },
        create: { chave, count: 1, resetAt: newResetAt },
        update: { count: 1, resetAt: newResetAt },
      });
      return shape(criado.count, criado.resetAt.getTime(), now);
    }

    // 3. janela viva — incrementa atomicamente.
    const atualizado = await db.loginThrottle.update({
      where: { chave },
      data: { count: { increment: 1 } },
    });
    return shape(atualizado.count, atualizado.resetAt.getTime(), now);
  } catch (err) {
    logger.warn({ err, chave }, "[rate-limit] DB indisponivel, fail-open");
    return {
      limited: false,
      count: 0,
      remaining: LOGIN_FAILURE_MAX,
      resetAt: now + LOGIN_FAILURE_WINDOW_MS,
      retryAfterSeconds: 0,
    };
  }
}

function shape(count: number, resetAtMs: number, now: number): LoginFailureResult {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  return {
    limited: count > LOGIN_FAILURE_MAX,
    count,
    remaining: Math.max(0, LOGIN_FAILURE_MAX - count),
    resetAt: resetAtMs,
    retryAfterSeconds,
  };
}

export async function recordLoginFailure(
  req: Request | NextRequest,
  email: string,
): Promise<LoginFailureResult> {
  return recordLoginFailureByKey(getLoginFailureKey(req.headers, email));
}

export async function resetLoginFailuresByKey(chave: string): Promise<void> {
  try {
    await db.loginThrottle.delete({ where: { chave } }).catch(() => {
      // Ja nao existe — ok.
    });
  } catch (err) {
    logger.warn({ err, chave }, "[rate-limit] reset falhou");
  }
}

export async function resetLoginFailures(
  req: Request | NextRequest,
  email: string,
): Promise<void> {
  await resetLoginFailuresByKey(getLoginFailureKey(req.headers, email));
}

/**
 * Cleanup periodico de buckets expirados. Roda no worker (job dedicado)
 * ou via cron — nao bloqueia o hot path do login.
 */
export async function cleanupExpiredLoginThrottle(
  now = Date.now(),
): Promise<number> {
  const result = await db.loginThrottle.deleteMany({
    where: { resetAt: { lt: new Date(now) } },
  });
  return result.count;
}

/**
 * Apenas para testes — limpa todos os buckets.
 */
export async function clearLoginFailureBucketsForTests(): Promise<void> {
  await db.loginThrottle.deleteMany();
}

export type RateLimitResult = {
  limited: boolean;
  count: number;
  resetAt: number;
  retryAfterSeconds: number;
};

/**
 * Rate-limit generico persistente. Reusa o model LoginThrottle como store
 * chave/count/resetAt — a `chave` DEVE ser namespaced pelo chamador
 * (ex: "recovery:<ip>:<email>") para nao colidir com o throttle de login.
 *
 * Incrementa atomicamente; reinicia o bucket quando a janela expira.
 * Fail-open: DB indisponivel libera (e loga) — mesmo racional do login.
 */
export async function consumeRateLimit(
  chave: string,
  windowMs: number,
  max: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  const newResetAt = new Date(now + windowMs);

  try {
    const atual = await db.loginThrottle.findUnique({ where: { chave } });

    if (!atual || atual.resetAt.getTime() <= now) {
      const criado = await db.loginThrottle.upsert({
        where: { chave },
        create: { chave, count: 1, resetAt: newResetAt },
        update: { count: 1, resetAt: newResetAt },
      });
      return shapeRateLimit(criado.count, criado.resetAt.getTime(), max, now);
    }

    const atualizado = await db.loginThrottle.update({
      where: { chave },
      data: { count: { increment: 1 } },
    });
    return shapeRateLimit(atualizado.count, atualizado.resetAt.getTime(), max, now);
  } catch (err) {
    logger.warn({ err, chave }, "[rate-limit] DB indisponivel, fail-open");
    return {
      limited: false,
      count: 0,
      resetAt: now + windowMs,
      retryAfterSeconds: 0,
    };
  }
}

function shapeRateLimit(
  count: number,
  resetAtMs: number,
  max: number,
  now: number,
): RateLimitResult {
  return {
    limited: count > max,
    count,
    resetAt: resetAtMs,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
  };
}

export const LOGIN_FAILURE_LIMIT = {
  max: LOGIN_FAILURE_MAX,
  windowMs: LOGIN_FAILURE_WINDOW_MS,
};
