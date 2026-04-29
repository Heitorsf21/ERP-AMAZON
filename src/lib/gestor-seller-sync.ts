import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { importarVendas } from "@/lib/fba-importer";

const execAsync = promisify(exec);

const ARQUIVO_PRODUTOS = "products_report.xlsx";
const ARQUIVO_ESTOQUE = "reports_fba_stock.xlsx";
const ARQUIVO_VENDAS = "reports_sales.xlsx";

export type ResultadoSyncGS = {
  scriptLog: string;
  produtosCriados: number;
  produtosAtualizados: number;
  estoquesSincronizados: number;
  metricasImportadas: number;
  vendasImportadas: number;
  skusNaoEncontrados: string[];
  erros: { arquivo: string; erro: string }[];
  loteMetricaId?: string;
};

// Converte valor BRL (Float do Excel) para centavos Int
function brlParaCentavos(valor: unknown): number {
  if (valor == null) return 0;
  const n =
    typeof valor === "number"
      ? valor
      : parseFloat(String(valor).replace(",", "."));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function toFloat(valor: unknown): number {
  if (valor == null) return 0;
  const n =
    typeof valor === "number"
      ? valor
      : parseFloat(String(valor).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function toInt(valor: unknown): number {
  if (valor == null) return 0;
  const n =
    typeof valor === "number"
      ? Math.round(valor)
      : parseInt(String(valor), 10);
  return isNaN(n) ? 0 : n;
}

// ── Importa products_report.xlsx ─────────────────────────────────────────────
//
// Cabeçalho esperado (1-indexed em ExcelJS row.values):
// [1] SKU Interno | [2] Título | [3] Custo Unitário Médio | [4] Preço |
// [5] Unidades Vendidas Totais | [6] Vendas Amazon | [7] Faturamento |
// [8] Lucro | [9] Margem | [10] Custo Ads |
// [11] Lucro | [12] Margem | [13] Custo Ads | [14] Lucro Pós Ads | [15] MPA

function normalizarHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
}

function criarMapaHeader(row: ExcelJS.Row | undefined) {
  const values = (row?.values ?? []) as Array<string | number | null>;
  const map = new Map<string, number>();
  values.forEach((value, idx) => {
    if (idx === 0) return;
    const normalized = normalizarHeader(value);
    if (normalized) map.set(normalized, idx);
  });
  return (aliases: string[], fallback: number) => {
    for (const alias of aliases) {
      const idx = map.get(normalizarHeader(alias));
      if (idx) return idx;
    }
    return fallback;
  };
}

async function importarProductsReport(
  buffer: Buffer,
  nomeArquivo: string,
): Promise<{
  produtosCriados: number;
  produtosAtualizados: number;
  metricasImportadas: number;
  loteMetricaId: string;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("products_report.xlsx: planilha não encontrada");

  const rows: ExcelJS.Row[] = [];
  ws.eachRow((row) => rows.push(row));

  if (rows.length < 2) throw new Error("products_report.xlsx: arquivo vazio");

  const agora = new Date();
  let produtosCriados = 0;
  let produtosAtualizados = 0;

  const lote = await db.loteMetricaGS.create({ data: { nomeArquivo } });
  const col = criarMapaHeader(rows[0]);
  const idx = {
    sku: col(["SKU Interno", "SKU"], 1),
    titulo: col(["Titulo", "Produto"], 2),
    custo: col(["Custo Unitario Medio", "Custo Unitario", "Custo"], 3),
    preco: col(["Preco", "Preco Venda"], 4),
    unidades: col(["Unidades Vendidas Totais", "Unidades Vendidas"], 5),
    vendasAmazon: col(["Vendas Amazon"], 6),
    faturamento: col(["Faturamento"], 7),
    lucro: col(["Lucro"], 8),
    margem: col(["Margem"], 9),
    custoAds: col(["Custo Ads"], 10),
    lucroPosAds: col(["Lucro Pos Ads"], 11),
    mpa: col(["MPA"], 12),
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const v = row.values as (string | number | null)[];

    const sku = String(v[idx.sku] ?? "").trim();
    if (!sku) continue;

    const titulo = String(v[idx.titulo] ?? "").trim() || null;
    const custoUnitarioCentavos = brlParaCentavos(v[idx.custo]) || null;
    const precoVendaCentavos = brlParaCentavos(v[idx.preco]) || null;

    // Upsert produto no catálogo ERP
    let produtoId: string | null = null;
    const existente = await db.produto.findUnique({ where: { sku } });

    if (existente) {
      await db.produto.update({
        where: { id: existente.id },
        data: {
          nome: titulo ?? existente.nome,
          custoUnitario: custoUnitarioCentavos ?? existente.custoUnitario,
          precoVenda: precoVendaCentavos ?? existente.precoVenda,
        },
      });
      produtoId = existente.id;
      produtosAtualizados++;
    } else {
      if (!titulo) continue; // sem nome não cria produto
      const novo = await db.produto.create({
        data: {
          sku,
          nome: titulo,
          custoUnitario: custoUnitarioCentavos ?? undefined,
          precoVenda: precoVendaCentavos ?? undefined,
          estoqueAtual: 0,
          estoqueMinimo: 0,
          unidade: "un",
          ativo: true,
        },
      });
      produtoId = novo.id;
      produtosCriados++;
    }

    // Salva snapshot de métricas do lote atual
    await db.produtoMetricaGestorSeller.upsert({
      where: { loteId_sku: { loteId: lote.id, sku } },
      update: {
        produtoId,
        titulo,
        custoUnitarioCentavos,
        precoVendaCentavos,
        unidadesVendidasTotais: toInt(v[idx.unidades]),
        vendasAmazonCentavos: brlParaCentavos(v[idx.vendasAmazon]),
        faturamentoCentavos: brlParaCentavos(v[idx.faturamento]),
        lucroCentavos: brlParaCentavos(v[idx.lucro]),
        margemPercentual: toFloat(v[idx.margem]),
        custoAdsCentavos: brlParaCentavos(v[idx.custoAds]),
        lucroPosAdsCentavos: brlParaCentavos(v[idx.lucroPosAds]),
        mpaPercentual: toFloat(v[idx.mpa]),
      },
      create: {
        loteId: lote.id,
        produtoId,
        sku,
        titulo,
        custoUnitarioCentavos,
        precoVendaCentavos,
        unidadesVendidasTotais: toInt(v[idx.unidades]),
        vendasAmazonCentavos: brlParaCentavos(v[idx.vendasAmazon]),
        faturamentoCentavos: brlParaCentavos(v[idx.faturamento]),
        lucroCentavos: brlParaCentavos(v[idx.lucro]),
        margemPercentual: toFloat(v[idx.margem]),
        custoAdsCentavos: brlParaCentavos(v[idx.custoAds]),
        lucroPosAdsCentavos: brlParaCentavos(v[idx.lucroPosAds]),
        mpaPercentual: toFloat(v[idx.mpa]),
      },
    });

    void agora; // usado como referência de data de movimentação quando necessário
  }

  const total = await db.produtoMetricaGestorSeller.count({
    where: { loteId: lote.id },
  });

  return {
    produtosCriados,
    produtosAtualizados,
    metricasImportadas: total,
    loteMetricaId: lote.id,
  };
}

// ── Sincroniza estoque via reports_fba_stock.xlsx ─────────────────────────────
//
// Cabeçalho: [1] Título | [2] SKU Externo | [3] Disponíveis | [4] Impedidas |
//            [5] Reservadas | [6] Valor Total De Venda | [7] Valor Total De Mercadorias
//
// Se o SKU não existir no ERP, o item é ignorado (registrado em skusNaoEncontrados).
// A criação de produtos a partir do FBA stock é intencional: se chegou aqui e ainda
// não existe no catálogo (não estava no products_report), cria produto básico.

async function sincronizarEstoqueGS(
  buffer: Buffer,
  nomeArquivo: string,
): Promise<{ estoquesSincronizados: number; skusNaoEncontrados: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("reports_fba_stock.xlsx: planilha não encontrada");

  const rows: ExcelJS.Row[] = [];
  ws.eachRow((row) => rows.push(row));

  if (rows.length < 2) throw new Error("reports_fba_stock.xlsx: arquivo vazio");

  const agora = new Date();
  let estoquesSincronizados = 0;
  const skusNaoEncontrados: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const v = row.values as (string | number | null)[];

    const titulo = String(v[1] ?? "").trim();
    const skuExterno = String(v[2] ?? "").trim();
    if (!skuExterno) continue;

    const disponiveis = Number(v[3] ?? 0);

    let produto = await db.produto.findUnique({ where: { sku: skuExterno } });

    // Cria produto básico quando existe no FBA mas não no catálogo ERP
    if (!produto) {
      if (!titulo) {
        skusNaoEncontrados.push(skuExterno);
        continue;
      }
      produto = await db.produto.create({
        data: {
          sku: skuExterno,
          nome: titulo,
          estoqueAtual: 0,
          estoqueMinimo: 0,
          unidade: "un",
          ativo: true,
        },
      });
    }

    const diff = disponiveis - produto.estoqueAtual;
    if (diff !== 0) {
      await db.$transaction([
        db.movimentacaoEstoque.create({
          data: {
            produtoId: produto.id,
            tipo: diff > 0 ? "ENTRADA" : "SAIDA",
            quantidade: Math.abs(diff),
            custoUnitario: produto.custoUnitario,
            origem: "AJUSTE",
            observacoes: `Sincronização Gestor Seller — ${nomeArquivo}`,
            dataMovimentacao: agora,
          },
        }),
        db.produto.update({
          where: { id: produto.id },
          data: { estoqueAtual: disponiveis },
        }),
      ]);
    }

    estoquesSincronizados++;
  }

  return { estoquesSincronizados, skusNaoEncontrados };
}

// ── Ponto de entrada principal ────────────────────────────────────────────────

export async function sincronizarGestorSeller(): Promise<ResultadoSyncGS> {
  const resultado: ResultadoSyncGS = {
    scriptLog: "",
    produtosCriados: 0,
    produtosAtualizados: 0,
    estoquesSincronizados: 0,
    metricasImportadas: 0,
    vendasImportadas: 0,
    skusNaoEncontrados: [],
    erros: [],
  };

  const scriptDir = process.env.GS_SCRIPT_DIR;
  if (!scriptDir) {
    resultado.erros.push({
      arquivo: "config",
      erro: "GS_SCRIPT_DIR não configurado no .env",
    });
    return resultado;
  }

  const scriptPath = path.join(scriptDir, "atualizar_relatorios.py");
  if (!fs.existsSync(scriptPath)) {
    resultado.erros.push({
      arquivo: "atualizar_relatorios.py",
      erro: `Script não encontrado em: ${scriptPath}`,
    });
    return resultado;
  }

  // Executa script Python — usa --espera 0 para não aguardar Gmail
  const cmd = `python "${scriptPath}" --espera 0`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: scriptDir,
      timeout: 180_000, // 3 min
      env: { ...process.env },
    });
    resultado.scriptLog = (
      stdout + (stderr ? `\nSTDERR: ${stderr}` : "")
    ).slice(0, 3000);
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    resultado.scriptLog = (
      (e.stdout ?? "") +
      "\n" +
      (e.stderr ?? "") +
      "\n" +
      (e.message ?? "")
    ).slice(0, 3000);
    // Continua mesmo com erro — arquivos podem ter sido baixados parcialmente
  }

  // 1. products_report.xlsx → cadastra/atualiza produtos + salva métricas
  const produtosPath = path.join(scriptDir, ARQUIVO_PRODUTOS);
  if (fs.existsSync(produtosPath)) {
    try {
      const buffer = fs.readFileSync(produtosPath);
      const r = await importarProductsReport(buffer, ARQUIVO_PRODUTOS);
      resultado.produtosCriados += r.produtosCriados;
      resultado.produtosAtualizados += r.produtosAtualizados;
      resultado.metricasImportadas += r.metricasImportadas;
      resultado.loteMetricaId = r.loteMetricaId;
    } catch (err) {
      resultado.erros.push({
        arquivo: ARQUIVO_PRODUTOS,
        erro: err instanceof Error ? err.message : "Erro ao importar produtos",
      });
    }
  } else {
    resultado.erros.push({
      arquivo: ARQUIVO_PRODUTOS,
      erro: "Arquivo não gerado pelo script",
    });
  }

  // 2. reports_fba_stock.xlsx → sincroniza estoques
  const estoquePath = path.join(scriptDir, ARQUIVO_ESTOQUE);
  if (fs.existsSync(estoquePath)) {
    try {
      const buffer = fs.readFileSync(estoquePath);
      const r = await sincronizarEstoqueGS(buffer, ARQUIVO_ESTOQUE);
      resultado.estoquesSincronizados += r.estoquesSincronizados;
      resultado.skusNaoEncontrados.push(...r.skusNaoEncontrados);
    } catch (err) {
      resultado.erros.push({
        arquivo: ARQUIVO_ESTOQUE,
        erro:
          err instanceof Error ? err.message : "Erro ao sincronizar estoque",
      });
    }
  } else {
    resultado.erros.push({
      arquivo: ARQUIVO_ESTOQUE,
      erro: "Arquivo não gerado pelo script",
    });
  }

  // 3. reports_sales.xlsx → importa vendas (opcional; não bloqueia em ausência)
  const vendasPath = path.join(scriptDir, ARQUIVO_VENDAS);
  if (fs.existsSync(vendasPath)) {
    try {
      const wb = new ExcelJS.Workbook();
      const buffer = fs.readFileSync(vendasPath);
      await wb.xlsx.load(
        buffer as unknown as Parameters<typeof wb.xlsx.load>[0],
      );
      const ws = wb.worksheets[0];
      if (ws) {
        const r = await importarVendas(ws, ARQUIVO_VENDAS);
        resultado.vendasImportadas += r.importadas;
      }
    } catch (err) {
      resultado.erros.push({
        arquivo: ARQUIVO_VENDAS,
        erro: err instanceof Error ? err.message : "Erro ao importar vendas",
      });
    }
  }

  return resultado;
}
