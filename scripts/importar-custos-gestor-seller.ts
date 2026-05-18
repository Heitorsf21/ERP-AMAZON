/**
 * Importa custos históricos a partir das planilhas reports_sales (*.xlsx).
 *
 * Para cada (SKU, data_da_venda), extrai o custo unitário (= "Preço de Custo"
 * total dividido pela quantidade) e detecta automaticamente quando o custo
 * mudou ao longo do tempo. Cria vigências em ProdutoCustoHistorico com data
 * de início precisa.
 *
 * Modos:
 *   --dry-run (default)  : analisa, mostra plano, NÃO escreve.
 *   --apply              : grava vigências + reaplica custo nas VendaAmazon.
 *
 * Args opcionais:
 *   --dir <path>         : pasta com as planilhas (default = cwd)
 *   --pattern <glob>     : padrão (default = "reports_sales (*).xlsx")
 *
 * Algoritmo:
 *   1. Lê todas as planilhas, normaliza linhas (1 linha = 1 pedido).
 *   2. Agrupa por SKU, ordena por data.
 *   3. Para cada SKU, percorre vendas em ordem cronológica e detecta troca
 *      de custo (diferença > 1 centavo, persistente em >= 2 vendas).
 *   4. Gera "vigências" — cada vigência tem (vigenciaInicio, vigenciaFim, custo).
 *   5. Mapeia SKU planilha -> Produto.id no banco; ignora SKUs não cadastrados.
 *   6. Insere vigências (com fechamento da anterior).
 *   7. Reaplica custo em VendaAmazon usando o helper resolverCustoUnitario.
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

type Args = {
  apply: boolean;
  dir: string;
  pattern: RegExp;
};

type LinhaPlanilha = {
  arquivo: string;
  amazonOrderId: string;
  status: string;
  dataCompra: Date;
  sku: string;
  titulo: string;
  asin: string;
  quantidade: number;
  custoTotal: number; // R$ (custo unitário × quantidade)
};

type Vigencia = {
  inicio: Date;
  fim: Date | null;
  custoCentavos: number;
  pedidosAmostra: string[];
};

const TOLERANCIA_CENTAVOS = 1; // diferenças <= 1¢ ignoradas (arredondamento)

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const dirIdx = argv.indexOf("--dir");
  const patIdx = argv.indexOf("--pattern");
  return {
    apply,
    dir: dirIdx >= 0 ? argv[dirIdx + 1]! : process.cwd(),
    pattern:
      patIdx >= 0
        ? new RegExp(argv[patIdx + 1]!)
        : /^reports_sales\s*\(\d+\)\.xlsx$/i,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL nao configurado");
  const args = parseArgs();
  console.log(`Modo: ${args.apply ? "APPLY" : "DRY-RUN"} | dir: ${args.dir}`);

  const arquivos = fs
    .readdirSync(args.dir)
    .filter((name) => args.pattern.test(name))
    .sort();

  console.log(`\n${arquivos.length} planilhas encontradas.`);
  if (arquivos.length === 0) return;

  const linhas = await lerTodasPlanilhas(args.dir, arquivos);
  console.log(`${linhas.length} linhas válidas.`);

  // Agrupa por SKU
  const porSku = new Map<string, LinhaPlanilha[]>();
  for (const l of linhas) {
    const arr = porSku.get(l.sku) ?? [];
    arr.push(l);
    porSku.set(l.sku, arr);
  }
  console.log(`${porSku.size} SKUs distintos na planilha.\n`);

  // Mapeia SKU -> Produto.id
  const produtos = await db.produto.findMany({
    where: { sku: { in: [...porSku.keys()] } },
    select: { id: true, sku: true, nome: true },
  });
  const produtoPorSku = new Map(produtos.map((p) => [p.sku, p]));
  const skusSemProduto = [...porSku.keys()].filter(
    (sku) => !produtoPorSku.has(sku),
  );

  // Para os órfãos com vendas no banco, cria Produto inativo automaticamente
  if (skusSemProduto.length > 0) {
    const comVendas = await db.vendaAmazon.groupBy({
      by: ["sku"],
      where: { sku: { in: skusSemProduto } },
      _count: { _all: true },
    });
    const skusComVendas = new Set(comVendas.map((r) => r.sku));
    const orfaosCriar = skusSemProduto.filter((sku) => skusComVendas.has(sku));
    const orfaosIgnorar = skusSemProduto.filter(
      (sku) => !skusComVendas.has(sku),
    );

    if (orfaosIgnorar.length > 0) {
      console.log(
        `⚠️  ${orfaosIgnorar.length} SKUs sem Produto E sem vendas no banco (ignorados):`,
      );
      console.log(`   ${orfaosIgnorar.join(", ")}\n`);
    }

    if (orfaosCriar.length > 0) {
      console.log(
        `🔧 ${orfaosCriar.length} SKUs descontinuados (com vendas no banco) — criando Produto inativo:`,
      );
      for (const sku of orfaosCriar) {
        const linhasDoSku = porSku.get(sku) ?? [];
        // Título mais frequente na planilha
        const tituloMaisFrequente = pickMaisFrequente(
          linhasDoSku.map((l) => l.titulo).filter(Boolean),
        );
        const asinMaisFrequente = pickMaisFrequente(
          linhasDoSku.map((l) => l.asin).filter(Boolean),
        );
        // Custo da última vigência (mais recente)
        const ordenadas = [...linhasDoSku].sort(
          (a, b) => b.dataCompra.getTime() - a.dataCompra.getTime(),
        );
        const ultimaLinha = ordenadas[0];
        const custoUltimo =
          ultimaLinha && ultimaLinha.quantidade > 0
            ? Math.round((ultimaLinha.custoTotal / ultimaLinha.quantidade) * 100)
            : null;

        console.log(
          `   - ${sku}: ${tituloMaisFrequente.slice(0, 60)}  (custo R$ ${custoUltimo ? (custoUltimo / 100).toFixed(2) : "—"})`,
        );

        if (args.apply) {
          const novo = await db.produto.create({
            data: {
              sku,
              nome: tituloMaisFrequente || sku,
              asin: asinMaisFrequente || null,
              custoUnitario: custoUltimo ?? undefined,
              ativo: false,
              estoqueAtual: 0,
              estoqueMinimo: 0,
              unidade: "un",
              observacoes:
                "Produto criado automaticamente pelo importador de custos (Gestor Seller). SKU descontinuado.",
            },
            select: { id: true, sku: true, nome: true },
          });
          produtoPorSku.set(sku, novo);
        }
      }
      console.log("");
    }
  }

  let vigenciasInseridas = 0;
  let skusComMudanca = 0;
  for (const [sku, linhasSku] of porSku) {
    const produto = produtoPorSku.get(sku);
    if (!produto) continue;

    const vigencias = detectarVigencias(linhasSku);
    if (vigencias.length === 0) continue;

    if (vigencias.length > 1) skusComMudanca++;

    console.log(`📦 ${sku} — ${produto.nome.slice(0, 50)} (${vigencias.length} vigência${vigencias.length > 1 ? "s" : ""})`);
    for (const v of vigencias) {
      const fim = v.fim ? v.fim.toISOString().slice(0, 10) : "—";
      console.log(
        `   ${v.inicio.toISOString().slice(0, 10)} → ${fim}  R$ ${(v.custoCentavos / 100).toFixed(2)}  (${v.pedidosAmostra.length} pedido(s))`,
      );
      if (args.apply) {
        await inserirVigencia({
          produtoId: produto.id,
          custoCentavos: v.custoCentavos,
          vigenciaInicio: v.inicio,
          vigenciaFim: v.fim,
          origem: ORIGEM_GESTOR_SELLER,
          observacao: `Importado de planilha. Amostra: ${v.pedidosAmostra.slice(0, 3).join(", ")}`,
        });
        vigenciasInseridas++;
      }
    }
  }

  console.log(`\n=== Resumo ===`);
  console.log(`  SKUs processados:    ${porSku.size - skusSemProduto.length}`);
  console.log(`  SKUs com mudança:    ${skusComMudanca}`);
  if (args.apply) {
    console.log(`  Vigências inseridas: ${vigenciasInseridas}`);
    console.log(`\nReaplicando custos em VendaAmazon...`);
    const r = await reaplicarCustoEmVendas();
    console.log(`  Vendas atualizadas:  ${r.atualizadas}`);
    console.log(`  Sem produto map.:    ${r.semProdutoMapeado}`);
  } else {
    console.log(`\n(dry-run — nada foi gravado. Use --apply para persistir.)`);
  }

  await db.$disconnect();
}

async function lerTodasPlanilhas(
  dir: string,
  arquivos: string[],
): Promise<LinhaPlanilha[]> {
  const linhas: LinhaPlanilha[] = [];
  for (const f of arquivos) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(dir, f));
    const sheet = wb.worksheets[0];
    if (!sheet) continue;

    sheet.eachRow((row, idx) => {
      if (idx === 1) return; // header
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
      // Ignora cancelados (raramente têm custo, mas se tiverem viesa)
      if (/cancel/i.test(status)) return;

      linhas.push({
        arquivo: f,
        amazonOrderId: orderId,
        status,
        dataCompra,
        sku,
        titulo: stringCell(v[9]),
        asin: stringCell(v[6]),
        quantidade,
        custoTotal,
      });
    });
  }
  return linhas;
}

/**
 * Para uma lista de vendas de um SKU (já filtradas), detecta vigências.
 *
 * Regra:
 *   - Ordena por dataCompra ASC.
 *   - Acompanha "custo atual". Quando custo da venda muda além da tolerância:
 *     - Se a mudança "persiste" (próxima venda diferente também tem novo
 *       custo OU é a última venda), fecha vigência anterior na data da
 *       mudança e abre nova.
 *     - Se for ponto isolado (1 venda com custo discrepante e a próxima
 *       volta ao custo anterior), considera ruído da planilha e ignora.
 */
function detectarVigencias(linhas: LinhaPlanilha[]): Vigencia[] {
  const ordenadas = [...linhas].sort(
    (a, b) => a.dataCompra.getTime() - b.dataCompra.getTime(),
  );
  const vigencias: Vigencia[] = [];
  let atual: Vigencia | null = null;

  for (let i = 0; i < ordenadas.length; i++) {
    const linha = ordenadas[i]!;
    const custoUnitCentavos = Math.round((linha.custoTotal / linha.quantidade) * 100);

    if (!atual) {
      atual = {
        inicio: linha.dataCompra,
        fim: null,
        custoCentavos: custoUnitCentavos,
        pedidosAmostra: [linha.amazonOrderId],
      };
      continue;
    }

    if (Math.abs(custoUnitCentavos - atual.custoCentavos) <= TOLERANCIA_CENTAVOS) {
      // Mesmo custo — só adiciona à amostra
      if (atual.pedidosAmostra.length < 5) atual.pedidosAmostra.push(linha.amazonOrderId);
      continue;
    }

    // Custo diferente — confirma se persiste olhando a próxima venda
    const proxima = ordenadas[i + 1];
    if (proxima) {
      const proxCusto = Math.round(
        (proxima.custoTotal / proxima.quantidade) * 100,
      );
      const proxIgualAtual =
        Math.abs(proxCusto - atual.custoCentavos) <= TOLERANCIA_CENTAVOS;
      if (proxIgualAtual) {
        // Ponto isolado — provavelmente erro de input no Gestor Seller.
        // Ignora a linha "esquisita" mas registra como observação implícita.
        continue;
      }
    }

    // Mudança confirmada — fecha vigência atual e abre nova
    atual.fim = linha.dataCompra;
    vigencias.push(atual);
    atual = {
      inicio: linha.dataCompra,
      fim: null,
      custoCentavos: custoUnitCentavos,
      pedidosAmostra: [linha.amazonOrderId],
    };
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
  if (typeof value === "object" && "result" in value) {
    return stringCell((value as { result: ExcelJS.CellValue }).result);
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: string }).text).trim();
  }
  return String(value).trim();
}

function numberCell(value: ExcelJS.CellValue): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(\D|$))/g, "")
      .replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && "result" in value) {
    return numberCell((value as { result: ExcelJS.CellValue }).result);
  }
  return 0;
}

function parseGestorDate(value: string): Date | null {
  if (!value) return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/,
  );
  if (!match) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const [, y, m, d, hh = "00", mm = "00", ss = "00"] = match;
  return new Date(
    Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
