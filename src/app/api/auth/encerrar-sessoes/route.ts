/**
 * Encerra todas as sessoes do usuario incrementando sessionVersion.
 * Cookies em outros devices viram invalidos no proximo request. O device
 * atual recebe um novo cookie com o `v` atualizado para nao ser deslogado.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bumpSessionVersion, requireSession } from "@/lib/auth";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const novoV = await bumpSessionVersion(session.uid);

  const user = await db.usuario.findUnique({
    where: { id: session.uid },
    select: { id: true, email: true, nome: true, role: true, ativo: true },
  });
  if (!user || !user.ativo) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const token = await signSession({
    uid: user.id,
    email: user.email,
    nome: user.nome,
    role: user.role,
    exp: buildSessionExpiry(false),
    v: novoV,
    // Preserva o empresaId — senao, sob TENANT_ISOLATION=enforce, o getSession
    // invalida o cookie reemitido (sem empresaId) e desloga o usuario.
    empresaId: session.empresaId,
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(false));
  return res;
}
