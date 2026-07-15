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

export type ForEachWithRateLimitOptions = {
  /** Envolve cada item; default `withAmazonRateLimitRetry`. Espera o cooldown
   *  LOCAL liberar (ex: 0.5 rps do Product Pricing) em vez de derrubar o lote. */
  retry?: <R>(fn: () => Promise<R>) => Promise<R>;
  /** Detecta erro de quota residual (429 real / cooldown longo). Ao dispará-lo,
   *  o lote PARA graciosamente em vez de virar FALHA. */
  isQuotaError: (error: unknown) => boolean;
};

/**
 * Processa `itens` em SEQUÊNCIA respeitando o rate-limit da SP-API.
 *
 * Cada item passa por `retry` (default `withAmazonRateLimitRetry`), que aguarda
 * o slot local liberar entre chamadas em vez de lançar. Se um item ainda assim
 * bater em quota — 429 real, cujo cooldown excede o orçamento de espera — o lote
 * PARA graciosamente e reporta `pausadoPorQuota: true`; os itens restantes ficam
 * para o próximo ciclo (o caller ordena por "mais antigo primeiro"). Um erro que
 * NÃO seja de quota propaga normalmente (falha real).
 *
 * Corrige o padrão em que um loop de chamadas SP-API sem espaçamento derruba o
 * job inteiro a partir da 2ª chamada (o gate reserva 1 slot a cada ~2s e lança).
 */
export async function forEachWithRateLimit<T>(
  itens: T[],
  processar: (item: T) => Promise<void>,
  options: ForEachWithRateLimitOptions,
): Promise<{ processados: number; pausadoPorQuota: boolean }> {
  const retry = options.retry ?? withAmazonRateLimitRetry;
  let processados = 0;

  for (const item of itens) {
    try {
      await retry(() => processar(item));
    } catch (error) {
      if (options.isQuotaError(error)) {
        return { processados, pausadoPorQuota: true };
      }
      throw error;
    }
    processados += 1;
  }

  return { processados, pausadoPorQuota: false };
}
