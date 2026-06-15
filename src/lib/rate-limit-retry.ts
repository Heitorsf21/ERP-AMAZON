import { isAmazonQuotaCooldownError } from "@/lib/amazon-rate-limit";

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_MAX_WAIT_MS = 5_000;
const SLOT_BUFFER_MS = 50;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RateLimitRetryOptions = {
  maxAttempts?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * Executa `fn` respeitando o cooldown local de rate-limit da SP-API.
 *
 * `reserveAmazonOperationSlot` lanca `AmazonQuotaCooldownError` ANTES de enviar
 * qualquer requisicao quando a operacao ainda esta dentro do intervalo minimo
 * entre chamadas (ex: 1 rps nas mutations de Ads). Numa execucao em lote isso
 * derruba todas as acoes depois da primeira, mesmo a Amazon respondendo 207/200.
 *
 * Como o cooldown e lancado PRE-fetch (nada chegou a ser enviado a Amazon),
 * reexecutar e idempotente e seguro: esperamos o slot liberar e tentamos de
 * novo, em vez de marcar a acao como FALHA. Cooldowns longos (acima de
 * `maxWaitMs`, tipicos de um 429 real) NAO sao aguardados — o erro propaga para
 * virar FALHA, sem travar a request do usuario.
 */
export async function withAmazonRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxAttempts && isAmazonQuotaCooldownError(error)) {
        const waitMs = error.nextAllowedAt.getTime() - now();
        if (waitMs <= maxWaitMs) {
          await sleep(Math.max(0, waitMs) + SLOT_BUFFER_MS);
          continue;
        }
      }
      throw error;
    }
  }
}
