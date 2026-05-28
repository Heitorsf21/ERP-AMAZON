const DEFAULT_MAX_XLSX_BYTES = 10 * 1024 * 1024;
const XLSX_ALLOWED_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const XLSX_ZIP_SIGNATURES = new Set(["504b0304", "504b0506", "504b0708"]);

export class ArquivoImportacaoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArquivoImportacaoInvalidoError";
  }
}

type ArquivoUpload = {
  name: string;
  size: number;
  type?: string;
};

export function normalizarNomeArquivoImportacao(nome: string) {
  const base = nome.split(/[\\/]/).pop()?.trim() || "arquivo.xlsx";
  return base
    .replace(/[\x00-\x1F\x7F]/g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .slice(0, 180);
}

export function validarArquivoXlsxUpload(
  arquivo: ArquivoUpload,
  maxBytes = DEFAULT_MAX_XLSX_BYTES,
) {
  const nomeArquivo = normalizarNomeArquivoImportacao(arquivo.name);
  const nomeLower = nomeArquivo.toLowerCase();

  if (!nomeLower.endsWith(".xlsx")) {
    throw new ArquivoImportacaoInvalidoError(
      "Arquivo invalido. Envie uma planilha .xlsx.",
    );
  }

  if (!Number.isFinite(arquivo.size) || arquivo.size <= 0) {
    throw new ArquivoImportacaoInvalidoError("Arquivo vazio.");
  }

  if (arquivo.size > maxBytes) {
    throw new ArquivoImportacaoInvalidoError(
      `Arquivo muito grande. Limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
    );
  }

  const mime = arquivo.type?.trim().toLowerCase() ?? "";
  if (!XLSX_ALLOWED_MIME_TYPES.has(mime)) {
    throw new ArquivoImportacaoInvalidoError(
      "Tipo de arquivo invalido. Envie uma planilha .xlsx.",
    );
  }

  return nomeArquivo;
}

export function validarBufferXlsx(
  buffer: Buffer,
  nomeArquivo = "arquivo.xlsx",
  maxBytes = DEFAULT_MAX_XLSX_BYTES,
) {
  const arquivo = {
    name: nomeArquivo,
    size: buffer.length,
    type: "",
  };
  validarArquivoXlsxUpload(arquivo, maxBytes);

  const assinatura = buffer.subarray(0, 4).toString("hex");
  if (!XLSX_ZIP_SIGNATURES.has(assinatura)) {
    throw new ArquivoImportacaoInvalidoError(
      "Arquivo XLSX invalido ou corrompido.",
    );
  }
}
