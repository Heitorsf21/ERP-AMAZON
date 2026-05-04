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

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.AMAZON_WORKER_INTERVAL_MS ?? 30_000);

async function main() {
  do {
    const result = await processAmazonSyncJobs({
      workerId: process.env.AMAZON_WORKER_ID ?? "amazon-worker",
      limit: Number(process.env.AMAZON_WORKER_BATCH_SIZE ?? 10),
      schedule: true,
    });

    if (result.processed > 0) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    }

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
