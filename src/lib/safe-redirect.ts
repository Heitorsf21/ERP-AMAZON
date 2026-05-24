/**
 * Valida e normaliza o destino de redirect pós-login.
 *
 * Bloqueia open-redirect via querystring `next`:
 *  - precisa começar com "/"
 *  - NÃO pode começar com "//" (scheme-relative → host externo)
 *  - NÃO pode começar com "/\" (Windows path-traversal de scheme)
 *  - NÃO pode conter ":" (impede "javascript:" ou "data:")
 *  - NÃO pode conter "\\" (bloqueia "/\\evil.com")
 *
 * Retorna sempre um caminho interno seguro.
 */
export function safeNextPath(next: string | undefined | null, fallback = "/home"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.includes(":") || next.includes("\\")) return fallback;
  return next;
}
