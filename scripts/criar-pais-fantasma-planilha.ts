/**
 * Para SKUs de variação órfãos cujo "pai" não existe nem como Produto nem
 * como irmão cadastrado: cria o Produto pai (inativo) extraindo dados das
 * planilhas reports_sales (*.xlsx), e depois cria as variações herdando.
 *
 * Resolve cenário onde a planilha agrupa todas variações sob o SKU pai
 * (ex: MFS-0022+ na planilha = MFS-0022+P, MFS-0022+B no banco).
 *
 * --dry-run (default) / --apply
 */
import * as fs from "fs";
import * as path from "path";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import {
  ORIGEM_GESTOR_SELLER,
  inserirVigencia,
  reaplicarCustoEmVendas,
} from "@/modules/produtos/custo-historico";

type Args = { apply: boolean; dir: string };

type LinhaPlanilha = {
  amazonOrderId: string;
  dataCompra: Date;
  sku: string;
  titulo: string;
  asin: string;
  quantidade: number;
  custoTotal: number;
  status: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf("--dir");
  return {
    apply: argv.includes("--apply"),
    dir: dirIdx >= 0 ? argv[dirIdx + 1]! : process.cwd(),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");
  const args = parseArgs();
  console.log(`Modo: ${args.apply ? "APPLY" : "DRY-RUN"} | dir: ${args.dir}`);

  const arquivos = fs
    .readdirSync(args.dir)
    .filter((name) => /^reports_sales\s*\(\d+\)\.xlsx$/i.test(name));

  if (arquivos.length === 0) {
    console.log("Nenhuma planilha encontrada.");
    return;
  }

  const linhas = await lerTodasPlanilhas(args.dir, arquivos);
  console.log(`${linhas.length} linhas lidas.`);

  // Agrupa por SKU da planilha
  const planilhaPorSku = new Map<string, LinhaPlanilha[]>();
  for (const l of linhas) {
    const arr = planilhaPorSku.get(l.sku) ?? [];
    arr.push(l);
    planilhaPorSku.set(l.sku, arr);
  }

  // Lista SKUs órfãos restantes no banco
  const orfaos = await db.$queryRawUnsafe<
    Array<{ sku: string; vendas: bigint }>
  >(`
    SELECT v.sku, COUNT(*)::bigint AS vendas
    FROM "VendaAmazon" v
    WHERE NOT EXISTS(SELECT 1 FROM "Produto" p WHERE p.sku = v.sku)
    GROUP BY v.sku
    ORDER BY vendas DESC;
  `);

  console.log(`\n${orfaos.length} SKUs órfãos restantes.\n`);
  if (orfaos.length === 0) return;

  let paisCriados = 0;
  let variacoesCriadas = 0;
  const naoResolvidos: string[] = [];
  const paisJaProcessados = new Map<string, string>(); // skuPai -> produtoId

  for (const { sku, vendas } of orfaos) {
    // SKUs sem "+" não são variações — tenta dados diretos da planilha
    const candidatosPai = sku.includes("+")
      ? [sku.slice(0, sku.lastIndexOf("+") + 1), sku.slice(0, sku.lastIndexOf("+"))]
      : [sku];

    let dadosPlanilhaPai: LinhaPlanilha[] | undefined;
    let skuPai: string | undefined;
    for (const candidato of candidatosPai) {
      const dados = planilhaPorSku.get(candidato);
      if (dados && dados.length > 0) {
        dadosPlanilhaPai = dados;
        skuPai = candidato;
        break;
      }
    }

    if (!dadosPlanilhaPai || !skuPai) {
      naoResolvidos.push(sku);
      continue;
    }

    // Já criou esse pai?
    let produtoPaiId = paisJaProcessados.get(skuPai);

    if (!produtoPaiId) {
      // Calcula nome (mais frequente) e detecta vigências da planilha
      const titulo =
        pickMaisFrequente(dadosPlanilhaPai.map((l) => l.titulo).filter(Boolean)) ||
        skuPai;
      const asin =
        pickMaisFrequente(dadosPlanilhaPai.map((l) => l.asin).filter(Boolean)) || null;
      const vigencias = detectarVigencias(dadosPlanilhaPai);
      const ultimaVigencia = vigencias[vigencias.length - 1];
      const custoAtual = ultimaVigencia?.custoCentavos ?? null;

      console.log(
        `🪄 Criando pai ${skuPai}: ${titulo.slice(0, 50)}  (${vigencias.length} vig., custo R$ ${custoAtual ? (custoAtual / 100).toFixed(2) : "—"})`,
      );

      if (args.apply) {
        const novoPai = await db.produto.create({
          data: {
            sku: skuPai,
            nome: titulo,
            asin,
            custoUnitario: custoAtual ?? undefined,
            ativo: false,
            estoqueAtual: 0,
            estoqueMinimo: 0,
            unidade: "un",
            observacoes:
              "SKU pai criado automaticamente — agrupador de variações descontinuado. Custo derivado das planilhas Gestor Seller.",
          },
          select: { id: true },
        });
        produtoPaiId = novoPai.id;
        paisJaProcessados.set(skuPai, produtoPaiId);

        // Insere vigências
        for (const v of vigencias) {
          await inserirVigencia({
            produtoId: produtoPaiId,
            custoCentavos: v.custoCentavos,
            vigenciaInicio: v.inicio,
            vigenciaFim: v.fim,
            origem: ORIGEM_GESTOR_SELLER,
            observacao: `Pai criado para resolver variação ${sku}`,
          });
        }
        paisCriados++;
      } else {
        // Em dry-run, só simula
        paisJaProcessados.set(skuPai, "DRY-RUN-PLACEHOLDER");
        paisCriados++;
      }
    }

    // Cria a variação como produto inativo
    const sufixo = sku.replace(skuPai, "") || sku;
    console.log(`   ↳ Variação ${sku} (${Number(vendas)} vendas, suf="${sufixo}")`);
    if (args.apply && produtoPaiId !== "DRY-RUN-PLACEHOLDER") {
      // Busca dados do pai para herdar
      const pai = await db.produto.findUnique({
        where: { id: produtoPaiId },
        select: { nome: true, custoUnitario: true, asin: true },
      });
      const vigenciasPai = await db.produtoCustoHistorico.findMany({
        where: { produtoId: produtoPaiId },
      });

      const novaVar = await db.produto.create({
        data: {
          sku,
          nome: `${pai!.nome} (var. ${sufixo})`,
          asin: pai!.asin,
          custoUnitario: pai!.custoUnitario,
          ativo: false,
          estoqueAtual: 0,
          estoqueMinimo: 0,
          unidade: "un",
          observacoes: `Variação descontinuada — herda custo do pai ${skuPai}.`,
        },
        select: { id: true },
      });

      for (const v of vigenciasPai) {
        await inserirVigencia({
          produtoId: novaVar.id,
          custoCentavos: v.custoCentavos,
          vigenciaInicio: v.vigenciaInicio,
          vigenciaFim: v.vigenciaFim,
          origem: ORIGEM_GESTOR_SELLER,
          observacao: `Herdada do pai ${skuPai}`,
        });
      }
      variacoesCriadas++;
    }
  }

  if (naoResolvidos.length > 0) {
    console.log(`\n⚠️  ${naoResolvidos.length} SKUs ainda não resolvidos:`);
    console.log(`   ${naoResolvidos.join(", ")}`);
  }

  console.log(`\n=== Resumo ===`);
  console.log(`  Pais criados:        ${paisCriados}`);
  console.log(`  Variações criadas:   ${variacoesCriadas}`);
  console.log(`  Não resolvidos:      ${naoResolvidos.length}`);

  if (args.apply && (paisCriados > 0 || variacoesCriadas > 0)) {
    console.log(`\nReaplicando custos em VendaAmazon...`);
    const r = await reaplicarCustoEmVendas();
    console.log(`  Vendas atualizadas:  ${r.atualizadas}`);
    console.log(`  Sem produto map.:    ${r.semProdutoMapeado}`);
  }

  await db.$disconnect();
}

async function lerTodasPlanilhas(dir: string, arquivos: string[]): Promise<LinhaPlanilha[]> {
  const linhas: LinhaPlanilha[] = [];
  for (const f of arquivos) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(dir, f));
    const sheet = wb.worksheets[0];
    if (!sheet) continue;

    sheet.eachRow((row, idx) => {
      if (idx === 1) return;
      const v = row.values as ExcelJS.CellValue[];
      const orderId = stringCell(v[1]);
      if (!orderId) return;
      const sku = stringCell(v[8]) || stringCell(v[7]);
      if (!sku) return;
      const dataCompra = parseGestorDate(stringCell(v[4]));
      if (!dataCompra) return;
      const quantidade = numberCell(v[10]);
      if (quantidade <= 0) return;
      const custoTotal = numberCell(v[24]);
      if (custoTotal <= 0) return;
      const status = stringCell(v[3]);
      if (/cancel/i.test(status)) return;
      linhas.push({
        amazonOrderId: orderId,
        dataCompra,
        sku,
        titulo: stringCell(v[9]),
        asin: stringCell(v[6]),
        quantidade,
        custoTotal,
        status,
      });
    });
  }
  return linhas;
}

function detectarVigencias(linhas: LinhaPlanilha[]) {
  const ordenadas = [...linhas].sort(
    (a, b) => a.dataCompra.getTime() - b.dataCompra.getTime(),
  );
  type V = { inicio: Date; fim: Date | null; custoCentavos: number };
  const vigencias: V[] = [];
  let atual: V | null = null;

  for (let i = 0; i < ordenadas.length; i++) {
    const linha = ordenadas[i]!;
    const custo = Math.round((linha.custoTotal / linha.quantidade) * 100);

    if (!atual) {
      atual = { inicio: linha.dataCompra, fim: null, custoCentavos: custo };
      continue;
    }

    if (Math.abs(custo - atual.custoCentavos) <= 1) continue;

    const proxima = ordenadas[i + 1];
    if (proxima) {
      const proxCusto = Math.round((proxima.custoTotal / proxima.quantidade) * 100);
      if (Math.abs(proxCusto - atual.custoCentavos) <= 1) continue;
    }

    atual.fim = linha.dataCompra;
    vigencias.push(atual);
    atual = { inicio: linha.dataCompra, fim: null, custoCentavos: custo };
  }

  if (atual) vigencias.push(atual);
  return vigencias;
}

function pickMaisFrequente(arr: string[]): string {
  if (arr.length === 0) return "";
  const cont = new Map<string, number>();
  for (const v of arr) cont.set(v, (cont.get(v) ?? 0) + 1);
  return [...cont.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

function stringCell(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "result" in value) return stringCell((value as { result: ExcelJS.CellValue }).result);
  if (typeof value === "object" && "text" in value) return String((value as { text: string }).text).trim();
  return String(value).trim();
}

function numberCell(value: ExcelJS.CellValue): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && "result" in value) return numberCell((value as { result: ExcelJS.CellValue }).result);
  return 0;
}

function parseGestorDate(value: string): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
}

main().catch((err) => { console.error(err); process.exit(1); });
