import { db } from "@/lib/db";
import { decryptConfigValue } from "@/lib/crypto";
import { getCatalogItem, type SPAPICredentials } from "@/lib/amazon-sp-api";

async function main() {
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "amazon_" } },
  });
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.chave] = decryptConfigValue(r.valor) ?? "";

  const creds: SPAPICredentials = {
    clientId: cfg.amazon_client_id || (process.env.AMAZON_LWA_CLIENT_ID ?? ""),
    clientSecret: cfg.amazon_client_secret || (process.env.AMAZON_LWA_CLIENT_SECRET ?? ""),
    refreshToken: cfg.amazon_refresh_token || (process.env.AMAZON_LWA_REFRESH_TOKEN ?? ""),
    marketplaceId: cfg.amazon_marketplace_id || "A2Q3Y263D00KWC",
    endpoint: cfg.amazon_endpoint || undefined,
  };

  const asin = "B0CQGDDMZ4";
  console.log(`Buscando catalogo para ASIN ${asin}...`);
  const item = await getCatalogItem(creds, asin);
  console.log(JSON.stringify(item, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
