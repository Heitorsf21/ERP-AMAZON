import { db } from "@/lib/db";

// SQS_PRIMARY é global: com ele, o ORDERS_SYNC cai para 15 min em TODAS as
// empresas — inclusive as que não têm assinatura ORDER_CHANGE (caso UDN, ~12
// min até ver a venda). Empresa sem ORDER_CHANGE recente volta ao polling curto.

const JANELA_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { valor: boolean; expira: number }>();

export async function empresaRecebeOrderChange(empresaId: string, agora: Date): Promise<boolean> {
  const emCache = cache.get(empresaId);
  if (emCache && emCache.expira > agora.getTime()) return emCache.valor;
  const ultima = await db.amazonNotification.findFirst({
    where: {
      empresaId,
      notificationType: "ORDER_CHANGE",
      criadoEm: { gte: new Date(agora.getTime() - JANELA_MS) },
    },
    select: { id: true },
  });
  const valor = !!ultima;
  cache.set(empresaId, { valor, expira: agora.getTime() + CACHE_TTL_MS });
  return valor;
}

export function intervaloEfetivo(
  schedule: { intervalMs: number; intervalMsSemSqs?: number },
  semSqs: boolean,
): number {
  return semSqs && schedule.intervalMsSemSqs ? schedule.intervalMsSemSqs : schedule.intervalMs;
}

export function __limparCacheSqsCobertura(): void {
  cache.clear();
}
