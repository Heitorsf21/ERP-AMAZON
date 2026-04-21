import { NextRequest, NextResponse } from "next/server";
import { processarBuffer } from "@/lib/fba-importer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const formData = await req.formData();
    const arquivo = formData.get("arquivo") as File | null;

    if (!arquivo)
      return NextResponse.json({ erro: "Arquivo não enviado" }, { status: 400 });

    const arrayBuf = await arquivo.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuf));

    const resultado = await processarBuffer(buffer, arquivo.name);
    return NextResponse.json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    if (
      msg.includes("não reconhecido") ||
      msg.includes("vazio") ||
      msg.includes("válida")
    ) {
      return NextResponse.json({ erro: msg }, { status: 400 });
    }
    console.error("[vendas/importar]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
