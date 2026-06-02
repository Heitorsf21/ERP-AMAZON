// F02 (T10): migra a credencial Amazon GLOBAL (ConfiguracaoSistema.amazon_refresh_token)
// para um AmazonAccount por empresa (refreshTokenEnc cifrado). Idempotente.
//
// Uso:
//   npx tsx scripts/migrar-credenciais-amazon-para-conta.ts            (DRY-RUN — não escreve)
//   npx tsx scripts/migrar-credenciais-amazon-para-conta.ts --apply    (aplica)
//
// NÃO remove a config global (fica como fallback do worker). A remoção é um passo
// separado, após confirmar o worker rodando por conta. Empresa alvo: WORKER_EMPRESA_ID
// (default "mundofs").
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { db } from "../src/lib/db";
import { decryptConfigValue, encryptConfigValue } from "../src/lib/crypto";

const apply = process.argv.includes("--apply");
const EMPRESA = process.env.WORKER_EMPRESA_ID || "mundofs";

async function lerConfig(chave: string): Promise<string | null> {
  const reg = await db.configuracaoSistema.findUnique({ where: { chave } });
  return decryptConfigValue(reg?.valor) ?? null;
}

async function main() {
  const refresh = await lerConfig("amazon_refresh_token");
  if (!refresh) {
    console.log("Sem amazon_refresh_token global — nada a migrar.");
    return;
  }

  const marketplaceId = await lerConfig("amazon_marketplace_id");
  const endpoint = await lerConfig("amazon_endpoint");
  const sellerId = await lerConfig("amazon_seller_id");

  // Pré-checagem: AmazonAccount.empresaId tem FK para Empresa (onDelete Cascade).
  // Em --apply, a Empresa precisa existir senão a criação falha.
  const empresa = await db.empresa.findUnique({ where: { id: EMPRESA } });
  const existente = await db.amazonAccount.findFirst({ where: { empresaId: EMPRESA } });

  console.log(
    `[${apply ? "APPLY" : "DRY-RUN"}] empresa=${EMPRESA} empresaExiste=${!!empresa} ` +
      `contaExistente=${!!existente} marketplaceId=${marketplaceId ?? "-"} ` +
      `sellerId=${sellerId ?? "-"} refresh=${refresh.slice(0, 4)}…(${refresh.length} chars)`,
  );

  if (!apply) {
    console.log("DRY-RUN: nada foi escrito. Rode com --apply para aplicar.");
    return;
  }

  if (!empresa) {
    throw new Error(
      `Empresa "${EMPRESA}" não existe — crie a empresa antes de migrar (FK AmazonAccount.empresaId).`,
    );
  }

  const data = {
    refreshTokenEnc: encryptConfigValue(refresh),
    marketplaceId: marketplaceId ?? undefined,
    endpoint: endpoint ?? undefined,
    sellerId: sellerId ?? undefined,
    status: "ATIVA" as const,
    ativa: true,
    conectadoEm: new Date(),
  };

  if (existente) {
    await db.amazonAccount.update({ where: { id: existente.id }, data });
    console.log(`Conta atualizada (id=${existente.id}).`);
  } else {
    const criada = await db.amazonAccount.create({
      data: { empresaId: EMPRESA, nome: "Conta Amazon (migrada)", ...data },
    });
    console.log(`Conta criada (id=${criada.id}).`);
  }
  console.log("Migração concluída. NÃO remova a config global ainda (fallback).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
