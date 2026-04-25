import { db } from "@/lib/db";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

async function main() {
  // Limpa cooldown atual de inventory pra rodar agora.
  await db.amazonApiQuota
    .update({
      where: { operation: "INVENTORY_SUMMARIES" },
      data: { nextAllowedAt: null },
    })
    .catch(() => null);

  const job = await db.amazonSyncJob.create({
    data: {
      tipo: TipoAmazonSyncJob.INVENTORY_SYNC,
      status: "QUEUED",
      priority: 100, // alta prioridade pra worker pegar primeiro
      payload: JSON.stringify({}),
      runAfter: new Date(),
      maxAttempts: 3,
    },
  });
  console.log(`Job INVENTORY_SYNC enfileirado: ${job.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
