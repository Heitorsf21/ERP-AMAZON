import crypto from "node:crypto";

export const CONVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function gerarTokenConvite(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashTokenConvite(rawToken) };
}

export function hashTokenConvite(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function expiracaoConvite(now = Date.now()): Date {
  return new Date(now + CONVITE_TTL_MS);
}
