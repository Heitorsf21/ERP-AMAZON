export const PLATAFORMA_COOKIE_NAME = "erp_plat_session";
const TWELVE_HOURS = 60 * 60 * 12;

export type PlataformaSessionPayload = {
  puid: string;
  email: string;
  nome: string;
  v: number;
  exp: number;
};

function getSecret(): string {
  const s = process.env.PLATAFORMA_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("PLATAFORMA_SESSION_SECRET ausente ou < 32 chars.");
  }
  return s;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function asBuf(a: Uint8Array): ArrayBuffer {
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;
}

export async function signPlataformaSession(p: PlataformaSessionPayload): Promise<string> {
  const key = await hmacKey();
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, asBuf(bytes)));
  return `${b64urlEncode(bytes)}.${b64urlEncode(sig)}`;
}

export async function verifyPlataformaSession(token: string | null | undefined): Promise<PlataformaSessionPayload | null> {
  if (!token) return null;
  try {
    const [pp, sp] = token.split(".");
    if (!pp || !sp) return null;
    const key = await hmacKey();
    const ok = await crypto.subtle.verify("HMAC", key, asBuf(b64urlDecode(sp)), asBuf(b64urlDecode(pp)));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(pp))) as PlataformaSessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function buildPlataformaCookieOptions() {
  return {
    httpOnly: true, sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
    path: "/", maxAge: TWELVE_HOURS, priority: "high" as const,
  };
}
export function buildPlataformaExpiry(): number {
  return Math.floor(Date.now() / 1000) + TWELVE_HOURS;
}
export function buildPlataformaClearCookie() {
  // `secure` DEVE casar com buildPlataformaCookieOptions (incl. COOKIE_SECURE):
  // o browser trata cookies com flag Secure diferente como distintos, entao um
  // clear sem Secure nao apagaria o cookie setado com Secure (logout falharia em
  // staging com COOKIE_SECURE=true e NODE_ENV!=production).
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 0,
  };
}
