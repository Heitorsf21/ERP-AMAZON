/**
 * One-shot: registra o SQS como destino no SP-API e cria subscriptions para
 * ORDER_CHANGE, ANY_OFFER_CHANGED e FBA_INVENTORY_AVAILABILITY_CHANGES.
 *
 * Destinations usam token grantless (client_credentials).
 * Subscriptions usam token normal (refresh_token) ligado ao seller.
 *
 * Uso: npx tsx scripts/setup-sqs-subscriptions.ts
 */
import { db } from "@/lib/db";
import {
  spApiRequest,
  getLWAToken,
  getLWAGrantlessToken,
  type SPAPICredentials,
} from "@/lib/amazon-sp-api";
import { getAmazonConfig, isAmazonConfigured } from "@/modules/amazon/service";

const QUEUE_ARN = "arn:aws:sqs:us-east-1:238788379344:amazon-sp-api-notifications";

type NotifEntry = { type: string; body?: Record<string, unknown> };

function buildNotificationTypes(marketplaceId: string): NotifEntry[] {
  return [
    {
      type: "ORDER_CHANGE",
      body: {
        payloadVersion: "1.0",
        processingDirective: {
          eventFilter: {
            eventFilterType: "ORDER_CHANGE",
            orderChangeTypes: ["ORDER_STATUS_CHANGE", "ORDER_SUMMARY_CHANGE"],
          },
        },
      },
    },
    { type: "FBA_INVENTORY_AVAILABILITY_CHANGES" },
    { type: "REPORT_PROCESSING_FINISHED" },
  ];
}

async function main() {
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

  const marketplaceId = creds.marketplaceId;
  const NOTIFICATION_TYPES = buildNotificationTypes(marketplaceId);

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
    (d) => d.resource?.sqs?.arn === QUEUE_ARN,
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
          body: { name: "erp-amazon-sqs", resourceSpecification: { sqs: { arn: QUEUE_ARN } } },
        },
      );
      destinationId = created.payload.destinationId;
      console.log(`  → Destination criado: ${destinationId}`);
    } catch (err) {
      // 409 = já existe mas GET não retornou (inconsistência SP-API)
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/already exists for the application/);
      if (match) {
        // Usa o ID da execução anterior (obtido via GET agora com listagem correta)
        destinationId = "fffdbad1-1252-40f0-913d-7183ea470f8f";
        console.log(`  → Destination já existia (409 conflict), reusando: ${destinationId}`);
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
