/**
 * Mock para teste manual do Marketing Stream — publica uma mensagem fake
 * direto via `recordAndDispatchSqsMessage()` sem precisar de fila AWS.
 *
 * Uso:
 *   npx tsx scripts/marketing-stream-mock.ts [--dataset sp-traffic] [--hours 2]
 *
 * Verifica que:
 *  1. A notificacao e gravada em AmazonNotification (audit).
 *  2. Um job AMAZON_ADS_STREAM_INGEST e enfileirado.
 *  3. Apos rodar `npm run amazon:worker:once`, linhas aparecem em AmazonAdsMetricaHoraria.
 */
import { recordAndDispatchSqsMessage } from "@/lib/amazon-sqs";

type Dataset =
  | "sp-traffic"
  | "sp-conversion"
  | "sd-traffic"
  | "sd-conversion"
  | "sb-traffic"
  | "sb-conversion";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

function startOfHourUtc(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

async function main() {
  const dataset = arg("dataset", "sp-traffic") as Dataset;
  const hoursAgo = Number(arg("hours", "1"));
  const profileId = arg("profileId", "12345");

  const hora = startOfHourUtc(new Date(Date.now() - hoursAgo * 3_600_000));
  const fim = new Date(hora.getTime() + 3_600_000);

  const record: Record<string, unknown> = {
    idempotencyId: `mock-${dataset}-${hora.toISOString()}`,
    marketplaceId: "A2Q3Y263D00KWC", // amazon.com.br
    profileId,
    timeWindowStart: hora.toISOString(),
    timeWindowEnd: fim.toISOString(),
    campaignId: "MOCK-CAMP-1",
    adGroupId: "MOCK-ADG-1",
    adId: "MOCK-AD-1",
    advertisedSku: "MFS-MOCK-001",
    advertisedAsin: "B000MOCK01",
    currency: "BRL",
  };
  if (dataset.endsWith("-traffic")) {
    record.impressions = 1000;
    record.clicks = 25;
    record.cost = 5_000_000; // 5 BRL → 500 centavos
  } else {
    record.attributedSales7d = 100_000_000; // 100 BRL → 10000 centavos
    record.attributedUnitsOrdered7d = 5;
    record.attributedPurchases7d = 3;
  }

  const body = JSON.stringify({
    notificationVersion: "1.0",
    notificationType: `marketing-stream:${dataset}`,
    payloadVersion: "1.0",
    notificationId: `mock-${dataset}-${Date.now()}`,
    payload: {
      datasetId: dataset,
      ...record,
    },
  });

  const result = await recordAndDispatchSqsMessage({
    Body: body,
    MessageId: `mock-${Date.now()}`,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dataset,
        hora: hora.toISOString(),
        notificationId: result.notificationId,
        jobsCriadosIds: result.jobsCriadosIds,
        instrucoes:
          "Rode `npm run amazon:worker:once` em seguida pra processar o job.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
