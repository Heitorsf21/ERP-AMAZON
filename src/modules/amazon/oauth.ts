// OAuth multi-seller da Amazon (F02). Funções puras + I/O isolado.
//
// Distinção que guia o design: APP CREDENTIAL (client_id/secret, identidade do
// app, compartilhada entre todos os sellers) vs SELLER GRANT (refresh_token,
// autorização individual de cada seller). Este módulo cuida do consentimento:
// assinar/verificar o `state` anti-CSRF, montar a URL de autorização e trocar o
// `spapi_oauth_code` por um refresh_token no endpoint LWA.

import { createHmac, timingSafeEqual } from "node:crypto";

export type OAuthState = { empresaId: string; nonce: string; exp: number };

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Assina o state (payload base64url + HMAC). Reusa o SESSION_SECRET do app. */
export function assinarState(state: OAuthState, secret: string): string {
  const payload = b64url(JSON.stringify(state));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verifica assinatura (timing-safe) + expiração. Retorna o state ou null.
 * `agoraSegundos` é injetado para testabilidade (epoch em segundos).
 */
export function verificarState(
  token: string,
  agoraSegundos: number,
  secret: string,
): OAuthState | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const esperado = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const state = JSON.parse(fromB64url(payload)) as OAuthState;
    if (typeof state.exp !== "number" || state.exp < agoraSegundos) return null;
    return state;
  } catch {
    return null;
  }
}
