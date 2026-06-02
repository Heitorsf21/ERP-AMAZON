import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { resolveFileServeHeaders } from "@/lib/file-serving";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    // Documento financeiro = PII/fiscal: restringe a FINANCEIRO/ADMIN (defense-in-
    // depth além do middleware, que hoje deixaria OPERADOR alcançar este path).
    const session = await requireRole(UsuarioRole.FINANCEIRO);
    const { id } = await params;
    const url = new URL(req.url);
    const download = url.searchParams.get("download") === "1";

    const doc = await db.documentoFinanceiro.findUnique({
      where: { id },
      select: {
        id: true,
        empresaId: true,
        nomeArquivo: true,
        caminhoArquivo: true,
        mimeType: true,
      },
    });

    // 404 uniforme para inexistente E para documento de outra empresa (anti-IDOR,
    // não revela existência). Seguro em modo off (checagem explícita aqui) e em
    // enforce (a extensão do Prisma também escopa por empresaId).
    if (
      !doc ||
      (session.empresaId && doc.empresaId && doc.empresaId !== session.empresaId)
    ) {
      return NextResponse.json(
        { error: "documento nao encontrado" },
        { status: 404 },
      );
    }

    // Path traversal protection: o caminho salvo no banco deve resolver
    // estritamente dentro de uploads/.
    const resolved = path.resolve(process.cwd(), doc.caminhoArquivo);
    const root = path.resolve(process.cwd(), "uploads");
    if (!resolved.startsWith(root + path.sep)) {
      logger.warn(
        { documentoId: id, caminho: doc.caminhoArquivo },
        "tentativa de acesso fora de uploads/",
      );
      return new NextResponse("Forbidden", { status: 403 });
    }

    let conteudo: Buffer;
    try {
      conteudo = await fs.readFile(resolved);
    } catch (err) {
      logger.error(
        { err, documentoId: id, caminho: resolved },
        "arquivo nao encontrado em disco",
      );
      return NextResponse.json(
        { error: "arquivo nao encontrado em disco" },
        { status: 404 },
      );
    }

    // Headers seguros: só tipos allowlistados (PDF/imagem) podem ir inline; o
    // resto vira download. Impede XSS armazenado via HTML/SVG servido no origin.
    const { contentType, disposition } = resolveFileServeHeaders(
      doc.mimeType,
      doc.nomeArquivo,
      download,
    );

    // Cria uma cópia em ArrayBuffer "puro" (sem SharedArrayBuffer) para o
    // tipo BodyInit aceitar — evita warnings com Buffer/Uint8Array<ArrayBufferLike>.
    const ab = new ArrayBuffer(conteudo.byteLength);
    new Uint8Array(ab).set(conteudo);

    return new NextResponse(ab, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Content-Length": String(conteudo.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "falha ao servir arquivo de documento");
    return NextResponse.json(
      { error: "falha ao servir arquivo" },
      { status: 500 },
    );
  }
}
