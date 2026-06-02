// Helpers para servir arquivos enviados pelo usuário com segurança.
//
// Vetor (audit 2026-06): documentos eram servidos `inline` com o Content-Type
// vindo do upload. Um arquivo HTML/SVG com mimeType text/html seria renderizado
// no MESMO origin → XSS armazenado + roubo de sessão. Aqui só permitimos inline
// para tipos comprovadamente seguros; o resto vira download (attachment) com
// application/octet-stream. O caller deve ainda enviar `X-Content-Type-Options: nosniff`.

/** Tipos seguros para exibir inline (renderizadores sandboxed, sem JS no origin). */
const SAFE_INLINE_MIME = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Sanitiza o nome de arquivo para uso em Content-Disposition: remove aspas,
 * CR/LF (header injection) e caracteres de controle. Fallback "arquivo".
 */
export function sanitizeFilename(name: string): string {
  const clean = (name ?? "")
    .replace(/[\r\n"\\\x00-\x1f]/g, "")
    .trim();
  return clean || "arquivo";
}

export type FileServeHeaders = { contentType: string; disposition: string };

/**
 * Decide Content-Type e Content-Disposition seguros. Tipos não-allowlistados
 * (ou forceDownload) viram attachment + octet-stream.
 */
export function resolveFileServeHeaders(
  mimeType: string | null | undefined,
  nomeArquivo: string,
  forceDownload: boolean,
): FileServeHeaders {
  const raw = (mimeType || "").toLowerCase().split(";")[0]!.trim();
  const safeInline = SAFE_INLINE_MIME.has(raw);
  const contentType = safeInline ? raw : "application/octet-stream";
  const filename = sanitizeFilename(nomeArquivo);
  const inline = !forceDownload && safeInline;
  const disposition = `${inline ? "inline" : "attachment"}; filename="${filename}"`;
  return { contentType, disposition };
}
