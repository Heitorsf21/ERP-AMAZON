import { db } from "@/lib/db";

async function main() {
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "amazon_" } },
    select: { chave: true, valor: true },
  });

  console.log("=== Amazon config no banco (ConfiguracaoSistema) ===");
  if (rows.length === 0) {
    console.log("(nenhuma chave amazon_* salva)");
  } else {
    for (const r of rows) {
      const enc = r.valor?.startsWith("enc:") ? " [criptografado]" : "";
      const len = r.valor?.length ?? 0;
      console.log(`  ${r.chave.padEnd(28)} len=${len}${enc}`);
    }
  }

  console.log("\n=== Env vars amazon_* ===");
  for (const k of [
    "AMAZON_LWA_CLIENT_ID",
    "AMAZON_LWA_CLIENT_SECRET",
    "AMAZON_LWA_REFRESH_TOKEN",
    "AMAZON_MARKETPLACE_ID",
    "AMAZON_SP_API_ENDPOINT",
  ]) {
    const v = process.env[k];
    console.log(`  ${k.padEnd(28)} ${v ? `setado (len=${v.length})` : "(vazio)"}`);
  }

  console.log("\n=== Status fila ===");
  const counts = await db.amazonSyncJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("  jobs:", counts);

  console.log("\n=== Configurado para sincronizar? ===");
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.chave] = r.valor;
  cfg.amazon_client_id ||= process.env.AMAZON_LWA_CLIENT_ID ?? "";
  cfg.amazon_client_secret ||= process.env.AMAZON_LWA_CLIENT_SECRET ?? "";
  cfg.amazon_refresh_token ||= process.env.AMAZON_LWA_REFRESH_TOKEN ?? "";
  cfg.amazon_marketplace_id ||= process.env.AMAZON_MARKETPLACE_ID ?? "";

  const ok =
    !!cfg.amazon_client_id &&
    !!cfg.amazon_client_secret &&
    !!cfg.amazon_refresh_token &&
    !!cfg.amazon_marketplace_id;
  console.log("  PRONTO:", ok);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
