/**
 * Limpa artefatos legados do fluxo Gestor Seller:
 *   1. Snapshots em ConfiguracaoSistema (chave 'gestor_seller_snapshot:*')
 *   2. Overrides em AmazonReembolso (statusFinanceiro=GESTOR_SELLER OR
 *      motivoCategoria=GESTOR_SELLER_VALIDATION OR
 *      referenciaExterna LIKE 'gestor-seller:%')
 *
 * Antes de deletar overrides, valida que cada um tem um Refund equivalente
 * em AmazonFinanceTransaction — assim o pipeline regenera depois sem perder
 * dados. Se algum override não tem refund equivalente, marca como
 * REFUND_ORFAO_PRE_API e mantém (não apaga).
 *
 * --dry-run (default) / --apply
 */
import { db } from "@/lib/db";

type Args = { apply: boolean };

function parseArgs(): Args {
  return { apply: process.argv.slice(2).includes("--apply") };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");
  const args = parseArgs();
  console.log(`Modo: ${args.apply ? "APPLY" : "DRY-RUN"}\n`);

  // ── 1. Snapshots ───────────────────────────────────────────────────
  console.log("=== Snapshots ConfiguracaoSistema ===");
  const snapshots = await db.configuracaoSistema.findMany({
    where: { chave: { startsWith: "gestor_seller_snapshot:" } },
    select: { chave: true },
    orderBy: { chave: "asc" },
  });
  console.log(`Encontrados: ${snapshots.length}`);
  for (const s of snapshots) console.log(`  - ${s.chave}`);

  if (args.apply && snapshots.length > 0) {
    const r = await db.configuracaoSistema.deleteMany({
      where: { chave: { startsWith: "gestor_seller_snapshot:" } },
    });
    console.log(`✓ ${r.count} snapshots removidos.\n`);
  }

  // ── 2. Overrides AmazonReembolso ───────────────────────────────────
  console.log("=== Overrides AmazonReembolso (Gestor Seller) ===");
  const overrides = await db.amazonReembolso.findMany({
    where: {
      OR: [
        { statusFinanceiro: "GESTOR_SELLER" },
        { motivoCategoria: "GESTOR_SELLER_VALIDATION" },
        { referenciaExterna: { startsWith: "gestor-seller:" } },
      ],
    },
    select: {
      id: true,
      amazonOrderId: true,
      sku: true,
      valorReembolsadoCentavos: true,
      dataReembolso: true,
      referenciaExterna: true,
    },
  });
  console.log(`Encontrados: ${overrides.length}\n`);

  // Classifica cada um: tem Refund equivalente em AmazonFinanceTransaction?
  let comRefundReal = 0;
  let orfaos = 0;
  const orfaoIds: string[] = [];
  const refundReaisIds: string[] = [];

  for (const o of overrides) {
    const refundReal = await db.amazonFinanceTransaction.findFirst({
      where: {
        amazonOrderId: o.amazonOrderId,
        transactionType: "Refund",
      },
      select: { transactionId: true },
    });
    if (refundReal) {
      comRefundReal++;
      refundReaisIds.push(o.id);
      console.log(
        `  🟢 ${o.amazonOrderId} ${o.sku}  R$ ${(o.valorReembolsadoCentavos / 100).toFixed(2)}  → tem ${refundReal.transactionId.slice(0, 30)} (seguro deletar)`,
      );
    } else {
      orfaos++;
      orfaoIds.push(o.id);
      console.log(
        `  🔴 ${o.amazonOrderId} ${o.sku}  R$ ${(o.valorReembolsadoCentavos / 100).toFixed(2)}  → SEM refund equivalente (manter como REFUND_ORFAO_PRE_API)`,
      );
    }
  }

  console.log(`\nClassificação: ${comRefundReal} com refund real | ${orfaos} órfãos`);

  if (args.apply) {
    // Deleta overrides redundantes (já cobertos por AmazonFinanceTransaction)
    if (refundReaisIds.length > 0) {
      const r = await db.amazonReembolso.deleteMany({
        where: { id: { in: refundReaisIds } },
      });
      console.log(`✓ ${r.count} overrides redundantes deletados.`);
    }

    // Marca órfãos como REFUND_ORFAO_PRE_API
    if (orfaoIds.length > 0) {
      const r = await db.amazonReembolso.updateMany({
        where: { id: { in: orfaoIds } },
        data: {
          motivoCategoria: "REFUND_ORFAO_PRE_API",
          statusFinanceiro: "ORFAO",
        },
      });
      console.log(`✓ ${r.count} overrides órfãos renomeados.`);
    }
  }

  console.log(`\n${args.apply ? "✓ Limpeza concluída." : "(dry-run — nada foi apagado.)"}`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
