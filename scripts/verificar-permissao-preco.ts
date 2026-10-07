/**
 * Verifica, SEM ALTERAR NADA, se o app pode mudar preço de anúncio (permissão
 * "Product Listing"): patchListingsItem com mode=VALIDATION_PREVIEW enviando
 * o PREÇO ATUAL do produto (cache amazonPrecoListagemCentavos).
 *
 * Uso: npx tsx scripts/verificar-permissao-preco.ts --empresa=mundofs --sku=MFS-0036
 */
import { loadEnvConfig } from "@next/env";
// Antes dos demais imports (mesmo padrão dos outros scripts): db lê DATABASE_URL ao carregar.
loadEnvConfig(process.cwd());
import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/tenant-context";
import { enviarPrecoAmazon, PermissaoListingNegadaError } from "@/modules/amazon/listings-preco";

function argumento(nome: string): string | null {
  const prefixo = `--${nome}=`;
  return process.argv.find((a) => a.startsWith(prefixo))?.slice(prefixo.length) || null;
}

async function main() {
  const empresaId = argumento("empresa") ?? "mundofs";
  const sku = argumento("sku");
  if (!sku) {
    console.error("Informe --sku=<SKU>");
    process.exit(1);
  }
  await runWithTenant({ empresaId, isSuperAdmin: false, source: "worker" }, async () => {
    const produto = await db.produto.findFirst({
      where: { sku },
      select: { amazonPrecoListagemCentavos: true },
    });
    const preco = produto?.amazonPrecoListagemCentavos;
    if (!preco) {
      console.error(`SKU ${sku} sem preço de listagem em cache — escolha outro SKU.`);
      process.exitCode = 1;
      return;
    }
    try {
      const r = await enviarPrecoAmazon({ sku, precoCentavos: preco, somenteValidar: true });
      console.log(`✓ Permissão OK (${empresaId}). Validação: ${r.status ?? "?"}`);
      if (r.issues?.length) console.log(JSON.stringify(r.issues, null, 2));
    } catch (e) {
      if (e instanceof PermissaoListingNegadaError) {
        console.log(`✗ ${empresaId}: 403 — falta a permissão Product Listing no app da Amazon.`);
        process.exitCode = 2;
        return;
      }
      throw e;
    }
  });
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
