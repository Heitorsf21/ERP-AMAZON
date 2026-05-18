/**
 * Cria Produto (ativo=false) para SKUs de variação que têm vendas no banco
 * mas não foram cadastrados. Deriva nome e custo do SKU "pai" mais próximo.
 *
 * Pai = SKU truncado em "+" (ou outros separadores). Ex:
 *   MFS-0022+P  -> pai = MFS-0022+
 *   MFS-0023+A  -> pai = MFS-0023+ (existe? usa esse; senão, MFS-0023)
 *
 * --dry-run (default) / --apply
 */
import { db } from "@/lib/db";
import {
  ORIGEM_GESTOR_SELLER,
  inserirVigencia,
  reaplicarCustoEmVendas,
} from "@/modules/produtos/custo-historico";

type Args = { apply: boolean };

function parseArgs(): Args {
  return { apply: process.argv.slice(2).includes("--apply") };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");
  const args = parseArgs();
  console.log(`Modo: ${args.apply ? "APPLY" : "DRY-RUN"}`);

  // 1. Lista SKUs órfãos (vendas no banco, sem Produto)
  const orfaos = await db.$queryRawUnsafe<
    Array<{ sku: string; vendas: bigint }>
  >(`
    SELECT v.sku, COUNT(*)::bigint AS vendas
    FROM "VendaAmazon" v
    WHERE NOT EXISTS(SELECT 1 FROM "Produto" p WHERE p.sku = v.sku)
    GROUP BY v.sku
    ORDER BY vendas DESC;
  `);

  console.log(`\n${orfaos.length} SKUs órfãos com vendas no banco.`);
  if (orfaos.length === 0) return;

  let criados = 0;
  let semPaiEncontrado = 0;
  const semPai: string[] = [];

  for (const { sku, vendas } of orfaos) {
    const candidatosPai = gerarCandidatosPai(sku);
    let pai: {
      id: string;
      nome: string;
      custoUnitario: number | null;
      asin: string | null;
      sku: string;
    } | null = null;

    // 1ª tentativa: SKU pai exato (MFS-0022+P -> MFS-0022+ ou MFS-0022)
    for (const candidato of candidatosPai) {
      const p = await db.produto.findUnique({
        where: { sku: candidato },
        select: { id: true, sku: true, nome: true, custoUnitario: true, asin: true },
      });
      if (p) {
        pai = p;
        break;
      }
    }

    // 2ª tentativa: qualquer irmão (mesmo prefixo + "+")
    if (!pai && candidatosPai.length > 0) {
      const prefixo = candidatosPai[0]!; // ex: MFS-0021+
      const irmao = await db.produto.findFirst({
        where: { sku: { startsWith: prefixo } },
        select: { id: true, sku: true, nome: true, custoUnitario: true, asin: true },
      });
      if (irmao) pai = irmao;
    }

    if (!pai) {
      semPaiEncontrado++;
      semPai.push(sku);
      continue;
    }

    // Pega vigências do pai para replicar
    const vigenciasPai = await db.produtoCustoHistorico.findMany({
      where: { produtoId: pai.id },
      orderBy: { vigenciaInicio: "asc" },
    });

    console.log(
      `  ${sku} (${Number(vendas)} vendas) → pai ${pai.sku}: ${pai.nome.slice(0, 50)} (${vigenciasPai.length} vig., custo R$ ${pai.custoUnitario ? (pai.custoUnitario / 100).toFixed(2) : "—"})`,
    );

    if (args.apply) {
      const sufixo = sufixoDe(sku, candidatosPai[0]!) || sku;
      const novoProduto = await db.produto.create({
        data: {
          sku,
          nome: `${pai.nome} (var. ${sufixo})`,
          asin: pai.asin,
          custoUnitario: pai.custoUnitario,
          ativo: false,
          estoqueAtual: 0,
          estoqueMinimo: 0,
          unidade: "un",
          observacoes: `Variação criada automaticamente — herda custo do SKU pai/irmão ${pai.sku}.`,
        },
        select: { id: true },
      });

      // Replica vigências do pai
      for (const v of vigenciasPai) {
        await inserirVigencia({
          produtoId: novoProduto.id,
          custoCentavos: v.custoCentavos,
          vigenciaInicio: v.vigenciaInicio,
          vigenciaFim: v.vigenciaFim,
          origem: ORIGEM_GESTOR_SELLER,
          observacao: `Herdada de SKU pai/irmão ${pai.sku}`,
        });
      }
      criados++;
    }
  }

  if (semPai.length > 0) {
    console.log(`\n⚠️  ${semPaiEncontrado} SKUs sem pai encontrado (ainda ficam sem custo):`);
    console.log(`   ${semPai.join(", ")}`);
  }

  console.log(`\n=== Resumo ===`);
  console.log(`  Total órfãos:           ${orfaos.length}`);
  console.log(`  Criados (com pai):      ${args.apply ? criados : orfaos.length - semPaiEncontrado}`);
  console.log(`  Sem pai encontrado:     ${semPaiEncontrado}`);

  if (args.apply && criados > 0) {
    console.log(`\nReaplicando custos em VendaAmazon...`);
    const r = await reaplicarCustoEmVendas();
    console.log(`  Vendas atualizadas:  ${r.atualizadas}`);
    console.log(`  Sem produto map.:    ${r.semProdutoMapeado}`);
  }

  await db.$disconnect();
}

/**
 * Gera candidatos a SKU pai para um SKU de variação.
 * MFS-0022+P -> [MFS-0022+, MFS-0022]
 * MFS-0009+A -> [MFS-0009+, MFS-0009]
 * MFS-0024+Pe -> [MFS-0024+, MFS-0024]
 */
function gerarCandidatosPai(sku: string): string[] {
  const candidatos: string[] = [];
  // Tenta truncar a partir do último "+"
  const idx = sku.lastIndexOf("+");
  if (idx > 0) {
    candidatos.push(sku.slice(0, idx + 1)); // mantém o "+" final
    candidatos.push(sku.slice(0, idx)); // sem o "+"
  }
  return candidatos;
}

function sufixoDe(sku: string, pai: string): string {
  return sku.replace(pai, "") || sku;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
