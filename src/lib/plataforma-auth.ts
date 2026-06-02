import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "./db";
import {
  PLATAFORMA_COOKIE_NAME, verifyPlataformaSession,
  type PlataformaSessionPayload,
} from "./plataforma-session";

export async function getPlataformaSession(): Promise<PlataformaSessionPayload | null> {
  const jar = await cookies();
  const payload = await verifyPlataformaSession(jar.get(PLATAFORMA_COOKIE_NAME)?.value);
  if (!payload) return null;
  const u = await db.plataformaUsuario.findUnique({
    where: { id: payload.puid },
    select: { ativo: true, sessionVersion: true },
  });
  if (!u || !u.ativo) return null;
  if (payload.v !== u.sessionVersion) return null;
  return payload;
}

/**
 * Para route handlers /api/plataforma/*. RETORNA (nao lanca) — no App Router do
 * Next, `throw new Response` vira 500 em vez de virar a resposta. O caller faz:
 *   const su = await requireSuperAdmin();
 *   if (su instanceof NextResponse) return su;   // 401
 *   // su: PlataformaSessionPayload
 */
export async function requireSuperAdmin(): Promise<PlataformaSessionPayload | NextResponse> {
  const s = await getPlataformaSession();
  if (!s) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }
  return s;
}
