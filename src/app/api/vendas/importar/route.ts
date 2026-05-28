import { NextRequest, NextResponse } from "next/server";
import { processarBuffer } from "@/lib/fba-importer";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  ArquivoImportacaoInvalidoError,
  validarArquivoXlsxUpload,
} from "@/lib/upload-security";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireRole(UsuarioRole.OPERADOR);
    const formData = await req.formData();
    const arquivo = formData.get("arquivo") as File | null;

    if (!arquivo)
      return NextResponse.json({ erro: "Arquivo não enviado" }, { status: 400 });

    const nomeArquivo = validarArquivoXlsxUpload(arquivo);
    const arrayBuf = await arquivo.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuf));

    const resultado = await processarBuffer(buffer, nomeArquivo);
    return NextResponse.json(resultado);
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    if (err instanceof ArquivoImportacaoInvalidoError) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : "Erro interno";
    if (
      msg.includes("não reconhecido") ||
      msg.includes("vazio") ||
      msg.includes("válida")
    ) {
      return NextResponse.json({ erro: msg }, { status: 400 });
    }
    logger.error({ err }, "[vendas/importar] falha");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
