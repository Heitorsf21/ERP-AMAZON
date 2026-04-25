import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function colIdx(headers: string[], ...candidatos: string[]): number {
  for (const c of candidatos) {
    const idx = headers.findIndex((h) =>
      h.toLowerCase().includes(c.toLowerCase()),
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseMoeda(val: string): number {
  const limpo = val.replace(/[R$%,\s"]/g, "").replace(",", ".").trim();
  return parseFloat(limpo) || 0;
}

function toCentavos(val: string): number {
  return Math.round(parseMoeda(val) * 100);
}

function safeCol(cols: string[], idx: number): string {
  if (idx < 0 || idx >= cols.length) return "";
  return cols[idx] ?? "";
}

function parseAmazonAdsCsv(conteudo: string) {
  const linhas = conteudo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (linhas.length < 2) throw new Error("Arquivo CSV muito curto");

  const primeiraLinha = linhas[0] ?? "";
  const sep = primeiraLinha.includes("\t") ? "\t" : ",";

  const headers = primeiraLinha
    .split(sep)
    .map((h) => h.replace(/^"|"$/g, "").trim());

  const iNome = colIdx(headers, "campaign name", "nome da campanha", "campaign");
  const iSku = colIdx(headers, "sku", "advertised sku");
  const iAsin = colIdx(headers, "asin", "advertised asin");
  const iImp = colIdx(headers, "impressions", "impressões", "impressoes");
  const iCliques = colIdx(headers, "clicks", "cliques", "click");
  const iGasto = colIdx(headers, "spend", "gasto", "investimento", "cost");
  const iVendas = colIdx(
    headers,
    "7-day total sales",
    "sales",
    "receita atribuída",
    "receita atribuida",
    "attributed sales",
  );
  const iPedidos = colIdx(headers, "7-day total orders", "orders", "pedidos");
  const iUnidades = colIdx(headers, "7-day total units", "units", "unidades");
  const iAcos = colIdx(headers, "acos", "advertising cost of sales");
  const iRoas = colIdx(headers, "roas", "return on advertising");

  if (iNome === -1 || iGasto === -1) {
    throw new Error(
      "Colunas obrigatórias não encontradas (Campaign Name, Spend). " +
        `Cabeçalhos detectados: ${headers.slice(0, 8).join(", ")}`,
    );
  }

  const registros: {
    nomeCampanha: string;
    asin: string | null;
    sku: string | null;
    impressoes: number;
    cliques: number;
    gastoCentavos: number;
    vendasAtribuidasCentavos: number;
    pedidos: number;
    unidades: number;
    acosPercentual: number | null;
    roas: number | null;
  }[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i] ?? "";
    const cols = linha.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const nome = safeCol(cols, iNome);
    if (!nome) continue;

    const gastoCentavos = toCentavos(safeCol(cols, iGasto));
    if (gastoCentavos <= 0) continue;

    const vendasCentavos = iVendas !== -1 ? toCentavos(safeCol(cols, iVendas)) : 0;

    const acosRaw = iAcos !== -1 ? parseMoeda(safeCol(cols, iAcos)) : null;
    const acosPercentual =
      acosRaw != null && acosRaw > 0
        ? acosRaw
        : vendasCentavos > 0
          ? (gastoCentavos / vendasCentavos) * 100
          : null;

    const roasRaw = iRoas !== -1 ? parseMoeda(safeCol(cols, iRoas)) : null;
    const roas =
      roasRaw != null && roasRaw > 0
        ? roasRaw
        : gastoCentavos > 0
          ? vendasCentavos / gastoCentavos
          : null;

    const asinVal = iAsin !== -1 ? safeCol(cols, iAsin) || null : null;
    const skuVal = iSku !== -1 ? safeCol(cols, iSku) || null : null;

    registros.push({
      nomeCampanha: nome,
      asin: asinVal,
      sku: skuVal,
      impressoes: iImp !== -1 ? Math.round(parseMoeda(safeCol(cols, iImp))) : 0,
      cliques: iCliques !== -1 ? Math.round(parseMoeda(safeCol(cols, iCliques))) : 0,
      gastoCentavos,
      vendasAtribuidasCentavos: vendasCentavos,
      pedidos: iPedidos !== -1 ? Math.round(parseMoeda(safeCol(cols, iPedidos))) : 0,
      unidades: iUnidades !== -1 ? Math.round(parseMoeda(safeCol(cols, iUnidades))) : 0,
      acosPercentual,
      roas,
    });
  }

  return registros;
}

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const arquivo = form.get("arquivo") as File | null;
  const periodoInicio = form.get("periodoInicio") as string | null;
  const periodoFim = form.get("periodoFim") as string | null;

  if (!arquivo) throw new Error("Arquivo obrigatório");
  if (!periodoInicio || !periodoFim) {
    throw new Error("Período obrigatório (periodoInicio e periodoFim)");
  }

  const conteudo = await arquivo.text();
  const registros = parseAmazonAdsCsv(conteudo);

  if (registros.length === 0) throw new Error("Nenhuma campanha válida encontrada");

  const inicio = new Date(periodoInicio + "T00:00:00");
  const fim = new Date(periodoFim + "T23:59:59");

  const criadas = await db.adsCampanha.createMany({
    data: registros.map((r) => ({
      ...r,
      periodoInicio: inicio,
      periodoFim: fim,
    })),
  });

  return ok({ importadas: criadas.count, total: registros.length });
});
