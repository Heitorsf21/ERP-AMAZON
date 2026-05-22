/**
 * CLI para gerenciar subscriptions do Amazon Marketing Stream.
 *
 * Uso:
 *   npx tsx scripts/marketing-stream-subscribe.ts list                # lista state
 *   npx tsx scripts/marketing-stream-subscribe.ts subscribe-all       # 6 datasets
 *   npx tsx scripts/marketing-stream-subscribe.ts subscribe sp-traffic
 *   npx tsx scripts/marketing-stream-subscribe.ts archive sp-traffic
 *
 * Le credenciais Ads do banco (ConfiguracaoSistema) e AMAZON_SQS_QUEUE_ARN do .env.
 */

import { getAmazonAdsCredentials } from "@/modules/amazon/ads-service";
import {
  archiveMarketingStreamDataset,
  getMarketingStreamQueueArn,
  getMarketingStreamSubscriptionStates,
  isMarketingStreamDataset,
  subscribeMarketingStreamDataset,
} from "@/modules/amazon/marketing-stream-service";
import {
  MARKETING_STREAM_DATASETS,
  type MarketingStreamDataset,
} from "@/modules/amazon/parsers/marketing-stream-events";

async function main() {
  const cmd = process.argv[2];
  const arg = process.argv[3];

  if (!cmd) {
    console.error(
      "Uso: list | subscribe-all | subscribe <dataset> | archive <dataset>",
    );
    process.exit(1);
  }

  const creds = await getAmazonAdsCredentials();
  if (!creds && cmd !== "list") {
    throw new Error("Credenciais Ads ausentes em ConfiguracaoSistema.");
  }

  if (cmd === "list") {
    const states = await getMarketingStreamSubscriptionStates(creds);
    console.log(JSON.stringify(states, null, 2));
    return;
  }

  const arn = getMarketingStreamQueueArn();
  if (!arn && (cmd === "subscribe" || cmd === "subscribe-all")) {
    throw new Error(
      "AMAZON_SQS_QUEUE_ARN nao configurado no .env — necessario para subscribe.",
    );
  }

  if (cmd === "subscribe-all") {
    for (const dataset of MARKETING_STREAM_DATASETS) {
      try {
        const result = await subscribeMarketingStreamDataset(creds!, dataset, arn!);
        console.log(
          JSON.stringify({ dataset, ok: true, subscriptionId: result.subscriptionId, status: result.status }),
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            dataset,
            ok: false,
            erro: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    return;
  }

  if (cmd === "subscribe") {
    if (!arg || !isMarketingStreamDataset(arg)) {
      throw new Error(`Dataset invalido: ${arg}`);
    }
    const result = await subscribeMarketingStreamDataset(
      creds!,
      arg as MarketingStreamDataset,
      arn!,
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "archive") {
    if (!arg || !isMarketingStreamDataset(arg)) {
      throw new Error(`Dataset invalido: ${arg}`);
    }
    const result = await archiveMarketingStreamDataset(
      creds!,
      arg as MarketingStreamDataset,
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error(`Comando desconhecido: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
