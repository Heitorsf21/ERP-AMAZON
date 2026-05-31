// Carrega .env / .env.local usando o mesmo loader do Next.js.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { pollSqsNotifications } from "../src/lib/amazon-sqs";
import { db } from "../src/lib/db";
import { runWithTenant } from "../src/lib/tenant-context";

const once = process.argv.includes("--once");
const intervalMs = Number(process.env.AMAZON_SQS_POLL_INTERVAL_MS ?? 2_000);
const HEARTBEAT_KEY = "sqs_consumer_heartbeat_at";

// Empresa do consumer (single-tenant por ora). A extensão de isolamento (db.ts)
// usa este contexto quando TENANT_ISOLATION=enforce; em "off" é inócuo. Vira
// per-AmazonAccount (resolvido por sellerId/marketplaceId do payload SQS) quando
// o roteamento por conta for implementado.
const SQS_EMPRESA_ID = process.env.WORKER_EMPRESA_ID || "mundofs";

async function main() {
  do {
    const result = await runWithTenant(
      { empresaId: SQS_EMPRESA_ID, isSuperAdmin: false, source: "worker" },
      () => pollSqsNotifications(),
    );
    await writeHeartbeat(result.enabled);

    if (result.processed > 0 || result.errors > 0 || once) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    }

    if (!once) {
      await sleep(intervalMs);
    }
  } while (!once);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });

async function writeHeartbeat(enabled: boolean) {
  const valor = JSON.stringify({ at: new Date().toISOString(), enabled });
  try {
    await db.configuracaoSistema.upsert({
      where: { chave: HEARTBEAT_KEY },
      create: { chave: HEARTBEAT_KEY, valor },
      update: { valor },
    });
  } catch {
    // Best effort.
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
