import { NextResponse } from "next/server";
import { documentosFinanceirosService } from "@/modules/documentos-financeiros/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const contaId = typeof body?.contaId === "string" ? body.contaId : "";
    if (!contaId) {
      return NextResponse.json(
        { error: "contaId obrigatorio" },
        { status: 400 },
      );
    }

    const dossie = await documentosFinanceirosService.vincularDossieAConta(
      id,
      contaId,
    );
    return NextResponse.json(dossie);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao vincular dossie";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
