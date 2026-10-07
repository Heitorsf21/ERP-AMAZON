import { db } from "@/lib/db";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { nome: string; expira: number }>();

/** Nome da loja no aviso ("Nova venda na MundoFS"). Empresa é GLOBAL. */
export async function nomeDaLoja(empresaId: string, agora = Date.now()): Promise<string> {
  const emCache = cache.get(empresaId);
  if (emCache && emCache.expira > agora) return emCache.nome;
  const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } });
  const nome = empresa?.nome?.trim() || "sua loja";
  cache.set(empresaId, { nome, expira: agora + TTL_MS });
  return nome;
}
