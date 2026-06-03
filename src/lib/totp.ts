// TOTP (RFC 6238) — fator MFA forte (autenticador) aprovado pela Amazon DPP.
// Wrapper fino sobre otplib v13 (API funcional). Puro + testável.
import { generateSecret, generateURI, verifySync } from "otplib";

/** Gera um segredo base32 para um novo enrolamento TOTP. */
export function gerarSegredoTotp(): string {
  return generateSecret();
}

/** Monta a URI otpauth:// usada no QR / entrada manual no app autenticador. */
export function montarOtpauthUri(
  secret: string,
  email: string,
  issuer = "Atlas Seller",
): string {
  return generateURI({ secret, label: email, issuer });
}

/**
 * Verifica um código TOTP de 6 dígitos contra o segredo. Tolerante a pequeno
 * desvio de relógio (janela padrão do otplib). Nunca lança.
 */
export function verificarTotp(token: string, secret: string): boolean {
  if (!/^\d{6}$/.test(token) || !secret) return false;
  try {
    return verifySync({ token, secret }).valid === true;
  } catch {
    return false;
  }
}
