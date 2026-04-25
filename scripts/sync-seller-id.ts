/**
 * One-shot: lê config Amazon atual, chama `getSellerId` (SP-API
 * /sellers/v1/marketplaceParticipations) e grava `amazon_seller_id`
 * em ConfiguracaoSistema.
 *
 * Uso: npx tsx scripts/sync-seller-id.ts
 */
import { db } from "@/lib/db";
import {
  getSellerAccount,
  getSellerId,
  type SPAPICredentials,
} from "@/lib/amazon-sp-api";
import { decryptConfigValue } from "@/lib/crypto";

const REQUIRED = [
  "amazon_client_id",
  "amazon_client_secret",
  "amazon_refresh_token",
  "amazon_marketplace_id",
] as const;

function maskSellerId(id: string): string {
  if (id.length <= 4) return id;
  return `${id.slice(0, 4)}${"X".repeat(Math.max(0, id.length - 4))}`;
}

async function loadConfig(): Promise<Record<string, string>> {
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "amazon_" } },
  });
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.chave] = decryptConfigValue(r.valor) ?? "";

  cfg.amazon_client_id ||= process.env.AMAZON_LWA_CLIENT_ID ?? "";
  cfg.amazon_client_secret ||= process.env.AMAZON_LWA_CLIENT_SECRET ?? "";
  cfg.amazon_refresh_token ||= process.env.AMAZON_LWA_REFRESH_TOKEN ?? "";
  cfg.amazon_marketplace_id ||= process.env.AMAZON_MARKETPLACE_ID ?? "";
  cfg.amazon_endpoint ||= process.env.AMAZON_SP_API_ENDPOINT ?? "";
  return cfg;
}

async function setManually(value: string) {
  await db.configuracaoSistema.upsert({
    where: { chave: "amazon_seller_id" },
    create: { chave: "amazon_seller_id", valor: value },
    update: { valor: value },
  });
  console.log(
    `[sync-seller-id] amazon_seller_id salvo manualmente: ${maskSellerId(value)} (len=${value.length})`,
  );
  process.exit(0);
}

async function main() {
  // Permite forçar o valor: `npx tsx scripts/sync-seller-id.ts --set A1B2C3...`
  // Útil quando o app não tem role para consultar /sellers/v1/account ou
  // /products/pricing/* (basta copiar do Seller Central → Settings → Account
  // Info → Your Merchant Token).
  const argSet = process.argv.indexOf("--set");
  if (argSet !== -1 && process.argv[argSet + 1]) {
    await setManually(process.argv[argSet + 1]!);
    return;
  }

  const cfg = await loadConfig();

  for (const k of REQUIRED) {
    if (!cfg[k]) {
      console.error(`[sync-seller-id] Faltando ${k} em ConfiguracaoSistema/.env`);
      process.exit(1);
    }
  }

  const creds: SPAPICredentials = {
    clientId: cfg.amazon_client_id!,
    clientSecret: cfg.amazon_client_secret!,
    refreshToken: cfg.amazon_refresh_token!,
    marketplaceId: cfg.amazon_marketplace_id!,
    endpoint: cfg.amazon_endpoint || undefined,
  };

  console.log("[sync-seller-id] Chamando /sellers/v1/account ...");
  let sellerId: string | null = null;
  try {
    const account = await getSellerAccount(creds);
    console.log(
      "[sync-seller-id] Resposta /sellers/v1/account:",
      JSON.stringify(account, null, 2).slice(0, 2000),
    );
    sellerId = account.payload?.sellerId ?? account.sellerId ?? null;
  } catch (err) {
    console.warn(
      "[sync-seller-id] /sellers/v1/account falhou — tentando fallback via getSellerId():",
      err instanceof Error ? err.message : String(err),
    );
    sellerId = await getSellerId(creds);
  }

  if (!sellerId) {
    console.error(
      "[sync-seller-id] Não foi possível resolver sellerId. Verifique se o app tem role 'Selling Partner Insights' habilitada.",
    );
    process.exit(2);
  }

  await db.configuracaoSistema.upsert({
    where: { chave: "amazon_seller_id" },
    create: { chave: "amazon_seller_id", valor: sellerId },
    update: { valor: sellerId },
  });

  console.log(
    `[sync-seller-id] amazon_seller_id salvo: ${maskSellerId(sellerId)} (len=${sellerId.length})`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[sync-seller-id] Falhou:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
