import { NextResponse } from "next/server";
import { documentosFinanceirosService } from "@/modules/documentos-financeiros/service";
import { requireRole, UsuarioRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    await requireRole(UsuarioRole.FINANCEIRO);
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
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao vincular dossie";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
