// Utilidades de autenticação para uso em handlers de rota (Node runtime).
import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  type SessionPayload,
  verifySession,
} from "./session";

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  return verifySession(token);
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
