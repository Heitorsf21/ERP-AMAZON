import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * Defesa CSRF defense-in-depth: valida o header `Origin` de requisicoes
 * mutaveis contra uma allowlist derivada de APP_URL (+ TRUSTED_ORIGINS).
 *
 * A defesa PRIMARIA de CSRF e o cookie de sessao `sameSite=lax` (ver
 * session.ts): o cookie nao acompanha POST/PATCH/DELETE cross-site. Esta
 * camada e adicional e mira sobretudo os endpoints de auth PRE-SESSAO
 * (login, recuperar/redefinir senha, 2FA), onde ainda nao ha cookie.
 *
 * Por padrao roda em REPORT-ONLY (apenas loga) para nao arriscar bloquear
 * trafego legitimo em prod antes de validar em staging — mesma estrategia do
 * CSP report-only -> enforce. Ative o bloqueio com CSRF_ENFORCE_ORIGIN=true.
 */

function parseOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getTrustedOrigins(): string[] {
  const origins = new Set<string>();

  const app = parseOrigin(process.env.APP_URL);
  if (app) origins.add(app);

  for (const extra of (process.env.TRUSTED_ORIGINS ?? "").split(",")) {
    const o = parseOrigin(extra.trim());
    if (o) origins.add(o);
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
  }

  return [...origins];
}

export type OriginCheck = { ok: boolean; origin: string | null; reason?: string };

/**
 * Avalia o Origin da requisicao. Fail-open (ok=true) quando:
 *  - nao ha header Origin (server-to-server, cron, curl) — `sameSite` ja cobre
 *    o caso de navegador;
 *  - nao ha allowlist configurada (APP_URL ausente) — nao da pra validar com
 *    seguranca, melhor nao bloquear que bloquear trafego legitimo.
 */
export function checkRequestOrigin(req: Request): OriginCheck {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true, origin: null, reason: "sem-origin" };

  const trusted = getTrustedOrigins();
  if (trusted.length === 0) return { ok: true, origin, reason: "sem-allowlist" };

  return { ok: trusted.includes(origin), origin };
}

function enforceEnabled(): boolean {
  return process.env.CSRF_ENFORCE_ORIGIN?.toLowerCase() === "true";
}

/**
 * Para uso no inicio de route handlers mutaveis. Retorna uma resposta 403
 * quando o Origin nao e confiavel E o enforce esta ligado; caso contrario
 * retorna `null` (em report-only apenas registra um warn).
 *
 * Uso:
 *   const bloqueio = originViolationResponse(req);
 *   if (bloqueio) return bloqueio;
 */
export function originViolationResponse(req: Request): NextResponse | null {
  const result = checkRequestOrigin(req);
  if (result.ok) return null;

  if (enforceEnabled()) {
    logger.warn({ origin: result.origin }, "[csrf] origin bloqueado (enforce)");
    return NextResponse.json({ erro: "ORIGIN_NAO_CONFIAVEL" }, { status: 403 });
  }

  logger.warn(
    { origin: result.origin, trusted: getTrustedOrigins() },
    "[csrf] origin nao confiavel (report-only) — ative CSRF_ENFORCE_ORIGIN para bloquear",
  );
  return null;
}
