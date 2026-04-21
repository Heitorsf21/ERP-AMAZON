import ExcelJS from "exceljs";
import { db } from "@/lib/db";

// ── Tipos de retorno ──────────────────────────────────────────────────────────

export type ResultadoVendas = {
  tipo: "VENDAS";
  loteId: string;
  importadas: number;
  periodoInicio: Date | null;
  periodoFim: Date | null;
};

export type ResultadoEstoque = {
  tipo: "ESTOQUE";
  loteId: string;
  totalSkus: number;
  atualizados: number;
  naoEncontrados: string[];
};

// ── Detecção de tipo ──────────────────────────────────────────────────────────

export function detectarTipo(
  header: (string | null)[],
): "VENDAS" | "ESTOQUE" | null {
  const h = header.map((v) => String(v ?? "").toLowerCase());
  if (h.some((v) => v.includes("id do pedido") || v.includes("data de compra")))
    return "VENDAS";
  if (h.some((v) => v.includes("disponív") || v.includes("disponivel")))
    return "ESTOQUE";
  return null;
}

// ── Importar vendas ───────────────────────────────────────────────────────────

export async function importarVendas(
  ws: ExcelJS.Worksheet,
  nomeArquivo: string,
): Promise<ResultadoVendas> {
  const rows: ExcelJS.Row[] = [];
  ws.eachRow((row) => rows.push(row));

  if (rows.length < 2) throw new Error("Arquivo vazio");

  const validos: {
    numeroPedido: string;
    marketplace: string;
    status: string;
    dataCompra: Date;
    asin: string;
    skuExterno: string;
    skuInterno: string;
    titulo: string;
    quantidade: number;
    precoUnitarioCentavos: number;
    totalCentavos: number;
  }[] = [];

  let periodoMin: Date | null = null;
  let periodoMax: Date | null = null;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const v = r.values as (string | number | Date | null)[];

    const numeroPedido = String(v[1] ?? "").trim();
    const status = String(v[3] ?? "").trim();

    if (!numeroPedido) continue;

    const statusNorm = status.toLowerCase();
    if (statusNorm === "cancelado" || statusNorm === "reembolsado") continue;

    const dataRaw = v[4];
    let dataCompra: Date;
    if (dataRaw instanceof Date) {
      dataCompra = dataRaw;
    } else {
      dataCompra = new Date(String(dataRaw));
      if (isNaN(dataCompra.getTime())) continue;
    }

    const skuExterno = String(v[7] ?? "").trim() || String(v[6] ?? "").trim();
    if (!skuExterno) continue;

    const quantidade = Number(v[10]) || 1;
    const precoUnit = Math.round(Number(v[11] ?? 0) * 100);
    const total = quantidade * precoUnit;

    validos.push({
      numeroPedido,
      marketplace: String(v[2] ?? "Amazon").trim(),
      status,
      dataCompra,
      asin: String(v[6] ?? "").trim(),
      skuExterno,
      skuInterno: String(v[8] ?? "").trim(),
      titulo: String(v[9] ?? "").trim(),
      quantidade,
      precoUnitarioCentavos: precoUnit,
      totalCentavos: total,
    });

    if (!periodoMin || dataCompra < periodoMin) periodoMin = dataCompra;
    if (!periodoMax || dataCompra > periodoMax) periodoMax = dataCompra;
  }

  if (validos.length === 0) throw new Error("Nenhuma venda válida encontrada");

  const lote = await db.loteImportacaoFBA.create({
    data: {
      nomeArquivo,
      tipo: "VENDAS",
      totalLinhas: validos.length,
      periodoInicio: periodoMin,
      periodoFim: periodoMax,
    },
  });

  for (const venda of validos) {
    await db.vendaFBA.upsert({
      where: {
        numeroPedido_skuExterno: {
          numeroPedido: venda.numeroPedido,
          skuExterno: venda.skuExterno,
        },
      },
      update: {
        status: venda.status,
        quantidade: venda.quantidade,
        precoUnitarioCentavos: venda.precoUnitarioCentavos,
        totalCentavos: venda.totalCentavos,
        loteId: lote.id,
      },
      create: { ...venda, loteId: lote.id },
    });
  }

  return {
    tipo: "VENDAS",
    loteId: lote.id,
    importadas: validos.length,
    periodoInicio: periodoMin,
    periodoFim: periodoMax,
  };
}

// ── Sincronizar estoque ───────────────────────────────────────────────────────

export async function sincronizarEstoque(
  ws: ExcelJS.Worksheet,
  nomeArquivo: string,
): Promise<ResultadoEstoque> {
  const rows: ExcelJS.Row[] = [];
  ws.eachRow((row) => rows.push(row));

  if (rows.length < 2) throw new Error("Arquivo vazio");

  const itens: { titulo: string; sku: string; disponiveis: number }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const v = row.values as (string | number | null)[];
    const sku = String(v[2] ?? "").trim();
    if (!sku) continue;
    const disponiveis = Number(v[3] ?? 0);
    itens.push({ titulo: String(v[1] ?? "").trim(), sku, disponiveis });
  }

  if (itens.length === 0) throw new Error("Nenhum SKU encontrado");

  const agora = new Date();
  let atualizados = 0;
  const naoEncontrados: string[] = [];

  for (const item of itens) {
    const produto = await db.produto.findUnique({ where: { sku: item.sku } });

    if (!produto) {
      naoEncontrados.push(item.sku);
      continue;
    }

    const diff = item.disponiveis - produto.estoqueAtual;
    if (diff === 0) {
      atualizados++;
      continue;
    }

    await db.$transaction([
      db.movimentacaoEstoque.create({
        data: {
          produtoId: produto.id,
          tipo: diff > 0 ? "ENTRADA" : "SAIDA",
          quantidade: Math.abs(diff),
          custoUnitario: produto.custoUnitario,
          origem: "AJUSTE",
          observacoes: `Sincronização FBA — ${nomeArquivo}`,
          dataMovimentacao: agora,
        },
      }),
      db.produto.update({
        where: { id: produto.id },
        data: { estoqueAtual: item.disponiveis },
      }),
    ]);

    atualizados++;
  }

  const lote = await db.loteImportacaoFBA.create({
    data: {
      nomeArquivo,
      tipo: "ESTOQUE",
      totalLinhas: itens.length,
      produtosAtualizados: atualizados,
    },
  });

  return {
    tipo: "ESTOQUE",
    loteId: lote.id,
    totalSkus: itens.length,
    atualizados,
    naoEncontrados,
  };
}

// ── Parser de workbook genérico ───────────────────────────────────────────────

export async function processarBuffer(
  buffer: Buffer,
  nomeArquivo: string,
): Promise<ResultadoVendas | ResultadoEstoque> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Planilha não encontrada no arquivo");

  const primeiraLinha: (string | null)[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    primeiraLinha.push(cell.text ?? null);
  });

  const tipo = detectarTipo(primeiraLinha);
  if (!tipo)
    throw new Error(
      "Formato não reconhecido. Envie reports_sales.xlsx ou reports_fba_stock.xlsx",
    );

  if (tipo === "VENDAS") return importarVendas(ws, nomeArquivo);
  return sincronizarEstoque(ws, nomeArquivo);
}
