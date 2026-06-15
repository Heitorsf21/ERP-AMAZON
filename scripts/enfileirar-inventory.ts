import { db } from "@/lib/db";
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

async function main() {
  // Limpa cooldown atual de inventory pra rodar agora.
  await db.amazonApiQuota
    .update({
      where: { operation: "INVENTORY_SUMMARIES" },
      data: { nextAllowedAt: null },
    })
    .catch(() => null);

  // Usa o enqueue oficial: resolve empresaId (contexto/background), respeita
  // dedupe e encoda o payload conforme o banco. priority alta pra worker pegar 1o.
  const job = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.INVENTORY_SYNC,
    {},
    { priority: 100, maxAttempts: 3 },
  );
  console.log(`Job INVENTORY_SYNC enfileirado: ${job.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
