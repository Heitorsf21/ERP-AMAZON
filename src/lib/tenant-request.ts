// Resolução de tenant a partir da REQUISIÇÃO web corrente (cookie de sessão).
//
// Por quê: rotas que usam requireRole/requireSession DIRETO (sem handleAuth) não
// conseguem propagar o contexto de tenant via AsyncLocalStorage — `enterWith`
// chamado dentro de getSession NÃO sobrevive ao `await` na continuação do handler
// (só runWithTenant/storage.run propaga). Para essas rotas, a extensão do Prisma
// (db.ts) usa esta função como fonte SECUNDÁRIA de contexto: lê o empresaId do
// cookie de sessão assinado (HMAC-verificado) da requisição corrente.
//
// Segurança: isto define apenas o ESCOPO (empresaId), nunca autoriza. O corpo da
// rota ainda chama requireRole/requireSession (valida ativo/role/sessionVersion)
// ANTES de qualquer query. O empresaId vem do cookie assinado — não é forjável.
// Multi-tenant correto: cada requisição usa o empresaId do seu próprio cookie.

import { SESSION_COOKIE_NAME, verifySession } from "./session";

/**
 * empresaId da requisição web corrente, lido do cookie de sessão assinado.
 * Retorna null fora de um request scope (worker/SQS/cron — que têm contexto ALS
 * próprio via runWithTenant) ou quando não há cookie válido. NUNCA lança.
 */
export async function resolveEmpresaIdFromRequestCookie(): Promise<string | null> {
  try {
    // import dinâmico: next/headers só existe/funciona dentro de uma requisição
    // Next. Em worker/scripts esta função nem é chamada (lá sempre há contexto ALS),
    // mas o import dinâmico + try/catch garante que nunca quebra fora do Next.
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    const payload = await verifySession(token);
    return payload?.empresaId ?? null;
  } catch {
    return null;
  }
}
