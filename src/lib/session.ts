// Assinatura/verificação de sessão via HMAC-SHA256 (Web Crypto).
// Compatível com runtime Edge (middleware) e Node (API routes).
// Token: base64url(payload).base64url(signature)

export const SESSION_COOKIE_NAME = "erp_session";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export type SessionPayload = {
  uid: string;
  email: string;
  nome: string;
  role: string;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET ausente ou menor que 32 caracteres. Gere um com: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
    );
  }
  return secret;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(padded);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function asBufferSource(a: Uint8Array): ArrayBuffer {
  // Subtle requires ArrayBuffer (não SharedArrayBuffer). Copiamos o slice exato.
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const key = await hmacKey();
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, asBufferSource(payloadBytes)),
  );
  return `${b64urlEncode(payloadBytes)}.${b64urlEncode(sig)}`;
}

export async function verifySession(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const [payloadPart, sigPart] = token.split(".");
    if (!payloadPart || !sigPart) return null;
    const payloadBytes = b64urlDecode(payloadPart);
    const sigBytes = b64urlDecode(sigPart);
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      asBufferSource(sigBytes),
      asBufferSource(payloadBytes),
    );
    if (!ok) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as SessionPayload;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function buildSessionCookieOptions(remember = false) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: remember ? THIRTY_DAYS_SECONDS : SEVEN_DAYS_SECONDS,
  };
}

export function sessionMaxAgeSeconds(remember = false): number {
  return remember ? THIRTY_DAYS_SECONDS : SEVEN_DAYS_SECONDS;
}

export function buildSessionExpiry(remember = false): number {
  return (
    Math.floor(Date.now() / 1000) +
    (remember ? THIRTY_DAYS_SECONDS : SEVEN_DAYS_SECONDS)
  );
}
