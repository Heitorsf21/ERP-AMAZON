/**
 * One-shot: registra o SQS como destino no SP-API e cria subscriptions para
 * ORDER_CHANGE, ANY_OFFER_CHANGED e FBA_INVENTORY_AVAILABILITY_CHANGES.
 *
 * Destinations usam token grantless (client_credentials).
 * Subscriptions usam token normal (refresh_token) ligado ao seller.
 *
 * Uso: npx tsx scripts/setup-sqs-subscriptions.ts
 */
import { loadEnvConfig } from "@next/env";
import { db } from "@/lib/db";
import {
  spApiRequest,
  getLWAToken,
  getLWAGrantlessToken,
  type SPAPICredentials,
} from "@/lib/amazon-sp-api";
import { getAmazonConfig, isAmazonConfigured } from "@/modules/amazon/service";

loadEnvConfig(process.cwd());

const QUEUE_ARN = process.env.AMAZON_SQS_QUEUE_ARN;

type NotifEntry = { type: string; body?: Record<string, unknown> };

function buildNotificationTypes(): NotifEntry[] {
  return [
    {
      type: "ORDER_CHANGE",
      body: {
        payloadVersion: "1.0",
        processingDirective: {
          eventFilter: {
            eventFilterType: "ORDER_CHANGE",
          },
        },
      },
    },
    { type: "FBA_INVENTORY_AVAILABILITY_CHANGES" },
    { type: "REPORT_PROCESSING_FINISHED" },
  ];
}

async function main() {
  const queueArn = QUEUE_ARN;
  if (!queueArn) {
    console.error("AMAZON_SQS_QUEUE_ARN nao configurado.");
    process.exit(1);
  }

  const config = await getAmazonConfig();
  if (!isAmazonConfigured(config)) {
    console.error("Credenciais Amazon não configuradas.");
    process.exit(1);
  }

  const creds: SPAPICredentials = {
    clientId: config.amazon_client_id!,
    clientSecret: config.amazon_client_secret!,
    refreshToken: config.amazon_refresh_token!,
    marketplaceId: config.amazon_marketplace_id!,
    endpoint: config.amazon_endpoint || undefined,
  };

  const NOTIFICATION_TYPES = buildNotificationTypes();

  // Token grantless para gerenciar destinations (não é vinculado a um seller)
  const grantlessToken = await getLWAGrantlessToken(creds, "sellingpartnerapi::notifications");
  console.log("✓ Token grantless obtido");

  // Token normal para subscriptions (vinculado ao seller via refresh_token)
  const sellerToken = await getLWAToken(creds);
  console.log("✓ Token seller obtido");

  // 1. Cria ou encontra destination
  console.log("\n[1] Registrando destino SQS no SP-API...");
  let destinationId: string;

  type Destination = { destinationId: string; name: string; resource: { sqs?: { arn: string } } };

  const existingDests = await spApiRequest<{ payload: { destinations: Destination[] } }>(
    creds,
    "/notifications/v1/destinations",
    { method: "GET", accessToken: grantlessToken },
  ).catch(() => null);

  const found = existingDests?.payload?.destinations?.find(
    (d) => d.resource?.sqs?.arn === queueArn,
  );

  if (found) {
    destinationId = found.destinationId;
    console.log(`  → Destination já existe: ${destinationId}`);
  } else {
    try {
      const created = await spApiRequest<{ payload: { destinationId: string } }>(
        creds,
        "/notifications/v1/destinations",
        {
          method: "POST",
          accessToken: grantlessToken,
          body: { name: "erp-amazon-sqs", resourceSpecification: { sqs: { arn: queueArn } } },
        },
      );
      destinationId = created.payload.destinationId;
      console.log(`  → Destination criado: ${destinationId}`);
    } catch (err) {
      // 409 = já existe mas GET não retornou (inconsistência SP-API)
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/already exists for the application/);
      if (match) {
        throw new Error(
          "Destination SQS ja existe para esta aplicacao, mas nao foi possivel localizar por AMAZON_SQS_QUEUE_ARN. Confirme o ARN ou remova o destino antigo na SP-API antes de recriar.",
        );
      } else {
        throw err;
      }
    }
  }

  // 2. Cria subscriptions (usam token do seller)
  console.log("\n[2] Criando subscriptions...");
  for (const { type: notifType, body: extraBody } of NOTIFICATION_TYPES) {
    try {
      const existing = await spApiRequest<{ payload: { subscriptionId?: string } }>(
        creds,
        `/notifications/v1/subscriptions/${notifType}`,
        { method: "GET", accessToken: sellerToken },
      ).catch(() => null);

      if (existing?.payload?.subscriptionId) {
        console.log(`  → ${notifType}: já ativa (${existing.payload.subscriptionId})`);
        continue;
      }

      const sub = await spApiRequest<{ payload: { subscriptionId: string } }>(
        creds,
        `/notifications/v1/subscriptions/${notifType}`,
        {
          method: "POST",
          accessToken: sellerToken,
          body: { payloadVersion: "1.0", destinationId, ...extraBody },
        },
      );
      console.log(`  ✓ ${notifType}: criada (${sub.payload.subscriptionId})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ ${notifType}: ${msg}`);
    }
  }

  console.log("\n✅ Setup concluído. Worker já drena a fila a cada loop.");
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
