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

/**
 * Monta a URL de consentimento do Seller Central (LWA). `draft=true` adiciona
 * `version=beta`, exigido enquanto o app não está publicado no Developer Console.
 */
export function montarAuthorizationUrl(opts: {
  sellerCentralBase: string;
  applicationId: string;
  state: string;
  draft: boolean;
}): string {
  const url = new URL("/apps/authorize/consent", opts.sellerCentralBase);
  url.searchParams.set("application_id", opts.applicationId);
  url.searchParams.set("state", opts.state);
  if (opts.draft) url.searchParams.set("version", "beta");
  return url.toString();
}

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

/**
 * Troca o `spapi_oauth_code` recebido no callback por um refresh_token (LWA,
 * grant_type=authorization_code). `fetchImpl` é injetável para teste. Lança em
 * 4xx/5xx ou quando a resposta não traz refresh_token/access_token.
 */
export async function trocarCodePorRefreshToken(
  code: string,
  creds: { clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const resp = await fetchImpl(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: creds.redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(`LWA authorization_code error ${resp.status}: ${String(payload.error ?? "")}`);
  }
  if (typeof payload.refresh_token !== "string" || typeof payload.access_token !== "string") {
    throw new Error("LWA: resposta sem refresh_token/access_token");
  }
  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : 3600,
  };
}
