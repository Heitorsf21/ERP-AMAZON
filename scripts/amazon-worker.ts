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
