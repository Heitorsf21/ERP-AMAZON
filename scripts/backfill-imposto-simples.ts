/**
 * Backfill do campo VendaAmazon.impostoSimplesCentavos para vendas existentes.
 *
 * Usa a aliquota e o flag ativo definidos em ConfiguracaoSistema
 * (ver src/modules/configuracao/imposto-simples.ts). Vendas marcadas como
 * REEMBOLSADO recebem 0 automaticamente.
 *
 * Uso:
 *   npx tsx scripts/backfill-imposto-simples.ts           # dry-run
 *   npx tsx scripts/backfill-imposto-simples.ts --apply   # grava
 *   npx tsx scripts/backfill-imposto-simples.ts --apply --batch 500
 */
import { db } from "@/lib/db";
import {
  getConfigImpostoSimples,
  IMPOSTO_SIMPLES_DEFAULTS,
} from "@/modules/configuracao/imposto-simples";
import { calcularImpostoSimplesCentavos } from "@/modules/vendas/valores";
import { valorBrutoDaVenda } from "@/modules/vendas/valores";

type Args = {
  apply: boolean;
  batch: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const batchIdx = argv.indexOf("--batch");
  const batchRaw = batchIdx >= 0 ? Number(argv[batchIdx + 1]) : NaN;
  const batch = Number.isFinite(batchRaw) && batchRaw > 0 ? batchRaw : 1000;
  return { apply, batch };
}

async function main() {
  const args = parseArgs();
  const cfg = await getConfigImpostoSimples();

  console.log(
    `[backfill-imposto-simples] modo=${args.apply ? "APPLY" : "DRY-RUN"} ` +
      `aliquotaBps=${cfg.aliquotaBps} ativo=${cfg.ativo} batch=${args.batch} ` +
      `(default=${IMPOSTO_SIMPLES_DEFAULTS.aliquotaBps})`,
  );

  type VendaLote = {
    id: string;
    quantidade: number;
    precoUnitarioCentavos: number;
    valorBrutoCentavos: number | null;
    impostoSimplesCentavos: number;
    statusPedido: string;
    statusFinanceiro: string;
  };

  let cursor: string | undefined = undefined;
  let totalLidas = 0;
  let totalAtualizadas = 0;
  let totalZeradas = 0;
  let totalIguais = 0;

  while (true) {
    const vendas: VendaLote[] = await db.vendaAmazon.findMany({
      take: args.batch,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        quantidade: true,
        precoUnitarioCentavos: true,
        valorBrutoCentavos: true,
        impostoSimplesCentavos: true,
        statusPedido: true,
        statusFinanceiro: true,
      },
    });

    if (vendas.length === 0) break;
    totalLidas += vendas.length;
    const ultima = vendas[vendas.length - 1];
    if (!ultima) break;
    cursor = ultima.id;

    const updates: Array<{ id: string; impostoSimplesCentavos: number }> = [];
    for (const venda of vendas) {
      const bruto = valorBrutoDaVenda({
        valorBrutoCentavos: venda.valorBrutoCentavos,
        precoUnitarioCentavos: venda.precoUnitarioCentavos,
        quantidade: venda.quantidade,
      });
      const novo = calcularImpostoSimplesCentavos({
        valorBrutoCentavos: bruto,
        aliquotaBps: cfg.aliquotaBps,
        ativo: cfg.ativo,
        statusPedido: venda.statusPedido,
        statusFinanceiro: venda.statusFinanceiro,
      });

      if (novo === venda.impostoSimplesCentavos) {
        totalIguais++;
        continue;
      }
      if (novo === 0) totalZeradas++;
      else totalAtualizadas++;
      updates.push({ id: venda.id, impostoSimplesCentavos: novo });
    }

    if (args.apply && updates.length > 0) {
      await db.$transaction(
        updates.map((u) =>
          db.vendaAmazon.update({
            where: { id: u.id },
            data: { impostoSimplesCentavos: u.impostoSimplesCentavos },
          }),
        ),
      );
    }

    console.log(
      `[backfill-imposto-simples] processadas=${totalLidas} ` +
        `atualizadas=${totalAtualizadas} zeradas=${totalZeradas} iguais=${totalIguais}`,
    );
  }

  console.log("\nResumo final:");
  console.log(`  lidas:        ${totalLidas}`);
  console.log(`  atualizadas:  ${totalAtualizadas}`);
  console.log(`  zeradas:      ${totalZeradas}`);
  console.log(`  iguais:       ${totalIguais}`);
  if (!args.apply) {
    console.log("\n(dry-run) Rode novamente com --apply para gravar.");
  }
}

main()
  .catch((err) => {
    console.error("[backfill-imposto-simples] erro:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
