import { cookies } from "next/headers";
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

/** Para route handlers /api/plataforma/*. Lanca 401 se nao houver superadmin. */
export async function requireSuperAdmin(): Promise<PlataformaSessionPayload> {
  const s = await getPlataformaSession();
  if (!s) {
    throw new Response(JSON.stringify({ erro: "NAO_AUTENTICADO" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }
  return s;
}
