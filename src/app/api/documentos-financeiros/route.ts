import { NextResponse } from "next/server";
import { documentosFinanceirosService } from "@/modules/documentos-financeiros/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dossies = await documentosFinanceirosService.listarDossies();
    return NextResponse.json(dossies);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "falha ao listar documentos financeiros" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const arquivo = formData.get("arquivo");
    const senhaPdfRaw = formData.get("senhaPdf");

    if (!(arquivo instanceof File)) {
      return NextResponse.json(
        { error: "arquivo obrigatorio" },
        { status: 400 },
      );
    }

    const senhaPdf = typeof senhaPdfRaw === "string" ? senhaPdfRaw : undefined;
    const resultado = await documentosFinanceirosService.processarUpload({
      arquivo,
      senhaPdf,
    });

    return NextResponse.json(resultado, { status: resultado.duplicado ? 200 : 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao processar documento";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
