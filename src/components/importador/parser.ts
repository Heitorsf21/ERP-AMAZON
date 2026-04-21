import { parse as csvParse } from "csv-parse/browser/esm/sync";
import ExcelJS from "exceljs";

export type ArquivoTabular = {
  headers: string[];
  rows: Record<string, string>[];
};

// Parser dos dois formatos que a planilha do usuário pode ter: CSV (delimitador
// auto-detectado entre "," e ";") e XLSX. A primeira linha não-vazia é
// tratada como cabeçalho.
export async function parseArquivoTabular(
  arquivo: File,
): Promise<ArquivoTabular> {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".xlsx") || nome.endsWith(".xls")) {
    return parseXlsx(arquivo);
  }
  return parseCsv(arquivo);
}

async function parseCsv(arquivo: File): Promise<ArquivoTabular> {
  const texto = await arquivo.text();
  const primeira = texto.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const virgulas = (primeira.match(/,/g) ?? []).length;
  const pontoVirgulas = (primeira.match(/;/g) ?? []).length;
  const delimiter = pontoVirgulas > virgulas ? ";" : ",";

  const registros = csvParse(texto, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    bom: true,
  }) as Record<string, string>[];

  const primeiro = registros[0];
  const headers = primeiro ? Object.keys(primeiro) : [];
  return { headers, rows: registros };
}

async function parseXlsx(arquivo: File): Promise<ArquivoTabular> {
  const buffer = await arquivo.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  let headers: string[] = [];
  const rows: Record<string, string>[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const valores = row.values as unknown[];
    // ExcelJS usa índice baseado em 1 em row.values (posição 0 é null)
    const celulas = valores.slice(1).map((v) => formatarCelula(v));

    if (rowNumber === 1) {
      headers = celulas.map((c) => c || "coluna_vazia");
      return;
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = celulas[i] ?? "";
    });
    // ignora linhas totalmente vazias
    if (Object.values(obj).some((v) => v.trim() !== "")) {
      rows.push(obj);
    }
  });

  return { headers, rows };
}

function formatarCelula(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const dia = String(v.getUTCDate()).padStart(2, "0");
    const mes = String(v.getUTCMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "object" && "text" in (v as Record<string, unknown>)) {
    // célula com rich text
    const texto = (v as { text: unknown }).text;
    return typeof texto === "string" ? texto : String(texto ?? "");
  }
  if (typeof v === "object" && "result" in (v as Record<string, unknown>)) {
    // célula com fórmula — usa o resultado calculado
    return String((v as { result: unknown }).result ?? "");
  }
  return String(v);
}
