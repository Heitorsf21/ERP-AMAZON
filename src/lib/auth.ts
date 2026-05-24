// Utilidades de autenticação para uso em handlers de rota (Node runtime).
import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  type SessionPayload,
  verifySession,
} from "./session";
import { UsuarioRole, type UsuarioRole as UsuarioRoleType } from "@/modules/shared/domain";
import { db } from "./db";

/**
 * Le e valida a sessao a partir do cookie. Alem do HMAC + exp (em verifySession),
 * verifica:
 *  - usuario existe e esta ativo
 *  - sessionVersion bate com o atual (se o payload trouxer `v`)
 *
 * Cookies antigos sem `v` (pre-migracao) recebem graceful pass — endurecer
 * essa regra apos 30 dias do deploy.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySession(token);
  if (!payload) return null;

  // Defense-in-depth: revalida ativo + sessionVersion no DB.
  const user = await db.usuario.findUnique({
    where: { id: payload.uid },
    select: { ativo: true, sessionVersion: true },
  });
  if (!user || !user.ativo) return null;
  if (payload.v != null && payload.v !== user.sessionVersion) return null;

  return payload;
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) {
    throw new Response(JSON.stringify({ erro: "NAO_AUTENTICADO" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return s;
}

export async function requireRole(
  ...roles: UsuarioRoleType[]
): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role === UsuarioRole.ADMIN || roles.includes(session.role as UsuarioRoleType)) {
    return session;
  }
  throw new Response(JSON.stringify({ erro: "NAO_AUTORIZADO" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Incrementa sessionVersion do usuario, invalidando todas as sessoes ativas
 * (exceto a que reemitir o cookie com o novo `v`). Usado em:
 *  - alterar-senha / redefinir-senha (invalida outros devices)
 *  - endpoint "encerrar todas as sessoes"
 */
export async function bumpSessionVersion(usuarioId: string): Promise<number> {
  const updated = await db.usuario.update({
    where: { id: usuarioId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return updated.sessionVersion;
}

export { UsuarioRole };
