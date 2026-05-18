/**
 * Re-executa o FINANCES_BACKFILL até cobrir todas as janelas pendentes.
 *
 * Uso:
 *   npx tsx scripts/force-finances-backfill.ts --reset-cursor 2025-07-28
 *   npx tsx scripts/force-finances-backfill.ts                       # continua de onde está
 *
 * Faz uma janela de 14 dias por iteração, até `completo=true`.
 * Para a cada erro mas grava progresso.
 */
import { db } from "@/lib/db";
import { runFinancesBackfill } from "@/modules/amazon/jobs-handlers";
import { getAmazonConfig, isAmazonConfigured } from "@/modules/amazon/service";

const CURSOR_KEY = "amazon_finances_backfill_cursor";
const LOJA_ABERTA_KEY = "amazon_loja_aberta_em";
const DEFAULT_LOJA_ABERTA = "2025-07-28T00:00:00.000Z";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");

  const argv = process.argv.slice(2);
  const resetIndex = argv.indexOf("--reset-cursor");
  const resetTo = resetIndex >= 0 ? argv[resetIndex + 1] : null;

  if (resetTo) {
    const date = new Date(resetTo);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(`Data inválida: ${resetTo}`);
    }
    await db.configuracaoSistema.upsert({
      where: { chave: CURSOR_KEY },
      create: { chave: CURSOR_KEY, valor: date.toISOString() },
      update: { valor: date.toISOString() },
    });
    console.log(`✓ Cursor resetado para ${date.toISOString()}`);
  }

  // Garante que loja-aberta-em existe (default 2025-07-28)
  const loja = await db.configuracaoSistema.findUnique({
    where: { chave: LOJA_ABERTA_KEY },
  });
  if (!loja) {
    await db.configuracaoSistema.create({
      data: { chave: LOJA_ABERTA_KEY, valor: DEFAULT_LOJA_ABERTA },
    });
    console.log(`✓ ${LOJA_ABERTA_KEY} criado com default ${DEFAULT_LOJA_ABERTA}`);
  }

  const cfg = await getAmazonConfig();
  if (!isAmazonConfigured(cfg)) {
    throw new Error("Credenciais Amazon não configuradas");
  }
  const creds = {
    clientId: cfg.amazon_client_id!,
    clientSecret: cfg.amazon_client_secret!,
    refreshToken: cfg.amazon_refresh_token!,
    marketplaceId: cfg.amazon_marketplace_id!,
    endpoint: cfg.amazon_endpoint || undefined,
  };

  let iter = 0;
  for (;;) {
    iter += 1;
    const start = Date.now();
    try {
      const result = await runFinancesBackfill(creds);
      const ms = Date.now() - start;
      console.log(`[iter ${iter}] ${ms}ms`, JSON.stringify(result));
      if ("completo" in result && result.completo) {
        console.log(`\n✓ Backfill concluído após ${iter} iterações.`);
        break;
      }
      // Respeita rate limit: pausa de 2s entre janelas
      await sleep(2000);
    } catch (err) {
      console.error(`[iter ${iter}] ERRO:`, err);
      // Pausa maior em caso de erro (provavelmente rate limit)
      await sleep(30000);
      // Continua tentando — o cursor não avança se houve erro real
      if (iter >= 50) {
        console.error("Limite de 50 iterações com erro — abortando.");
        break;
      }
    }
  }

  await db.$disconnect();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
