/**
 * Criptografia simétrica para credenciais sensíveis em ConfiguracaoSistema.
 *
 * Algoritmo: AES-256-GCM (autenticação integrada).
 * Chave master: env CONFIG_ENCRYPTION_KEY (32 bytes em hex).
 *
 * Formato persistido: `enc:v1:<iv_base64>:<tag_base64>:<ciphertext_base64>`
 * O prefixo `enc:` permite distinguir valores criptografados de valores antigos
 * em texto puro durante a transição.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";
const KEY_LEN = 32;
const IV_LEN = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `CONFIG_ENCRYPTION_KEY deve ter ${KEY_LEN} bytes em hex (${KEY_LEN * 2} caracteres). Atual: ${buf.length} bytes.`,
    );
  }
  cachedKey = buf;
  return cachedKey;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function requireEncryptionKeyForSecret() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY ausente. Configure a chave antes de salvar credenciais sensiveis.",
    );
  }
}

/**
 * Criptografa um valor. Em desenvolvimento sem chave, preserva compatibilidade
 * com valores legados em texto puro; em producao, exige criptografia.
 */
export function encryptConfigValue(plain: string): string {
  const key = getKey();
  if (!key) {
    requireEncryptionKeyForSecret();
    return plain;
  }

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Descriptografa. Se o valor não tem prefixo `enc:`, retorna como veio
 * (compatibilidade com valores legados em texto puro).
 */
export function decryptConfigValue(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (!isEncrypted(stored)) return stored;

  const key = getKey();
  if (!key) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY ausente — não é possível descriptografar valores. Configure a env var.",
    );
  }

  const body = stored.slice(PREFIX.length);
  const [ivB64, tagB64, ctB64] = body.split(":");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Valor criptografado em formato invalido.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * Heurística: chaves cujo nome sugere segredo. Usado para decidir se um valor
 * em ConfiguracaoSistema deve ser criptografado em repouso.
 */
export function isSecretConfigKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("secret") ||
    k.includes("token") ||
    k.includes("password") ||
    k.includes("senha") ||
    k.endsWith("_key") ||
    k.endsWith("_apikey")
  );
}
