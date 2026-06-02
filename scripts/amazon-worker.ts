// Carrega .env / .env.local / .env.production usando o mesmo loader do Next.js.
// tsx não auto-carrega .env, e em prod o PM2 só herda o env do shell que disparou
// o `pm2 start` — sem isto o worker entrava sem DATABASE_URL/INTERNAL_HEALTH_TOKEN/etc.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// Validação de segurança: CONFIG_ENCRYPTION_KEY obrigatória em produção
if (process.env.NODE_ENV === "production" && !process.env.CONFIG_ENCRYPTION_KEY) {
  console.error(
    "[worker] ERRO CRÍTICO: CONFIG_ENCRYPTION_KEY não definida em produção.\n" +
    "  Credenciais Amazon seriam salvas em texto puro. Configure a variável e reinicie.\n" +
    "  Gere uma chave: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
  process.exit(1);
}

// Aviso em desenvolvimento (não bloqueia)
if (process.env.NODE_ENV !== "production" && !process.env.CONFIG_ENCRYPTION_KEY) {
  console.warn(
    "[worker] AVISO: CONFIG_ENCRYPTION_KEY não definida. " +
    "Credenciais serão salvas em texto puro no banco de desenvolvimento.",
  );
}

import { processAmazonSyncJobs } from "../src/modules/amazon/worker";
import { cleanupExpiredLoginThrottle } from "../src/lib/auth-rate-limit";
import { runStartupChecks } from "../src/lib/startup-checks";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.AMAZON_WORKER_INTERVAL_MS ?? 30_000);

// Cleanup do LoginThrottle: deleta buckets expirados 1x/hora. Operação leve
// (DELETE com índice em resetAt). Sem isso a tabela cresce devagar mas sem
// limite teórico.
const LOGIN_THROTTLE_CLEANUP_INTERVAL_MS = 60 * 60_000;
let lastLoginThrottleCleanup = 0;

async function maybeRunLoginThrottleCleanup() {
  const now = Date.now();
  if (now - lastLoginThrottleCleanup < LOGIN_THROTTLE_CLEANUP_INTERVAL_MS) return;
  try {
    const removed = await cleanupExpiredLoginThrottle();
    lastLoginThrottleCleanup = now;
    if (removed > 0) {
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          task: "login_throttle_cleanup",
          removed,
        }),
      );
    }
  } catch (err) {
    console.error("[worker] login_throttle_cleanup falhou:", err);
  }
}

async function main() {
  // Guards de boot (segredos obrigatórios + isolamento multi-tenant quando há 2+
  // empresas). Aborta o worker em produção se algo crítico estiver mal configurado.
  try {
    await runStartupChecks();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  do {
    const result = await processAmazonSyncJobs({
      workerId: process.env.AMAZON_WORKER_ID ?? "amazon-worker",
      limit: Number(process.env.AMAZON_WORKER_BATCH_SIZE ?? 10),
      schedule: true,
    });

    if (result.processed > 0) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    }

    await maybeRunLoginThrottleCleanup();

    if (!once) {
      await sleep(intervalMs);
    }
  } while (!once);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
