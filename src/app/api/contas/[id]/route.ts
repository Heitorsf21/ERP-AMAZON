import { NextResponse } from "next/server";
import { contasService } from "@/modules/contas-a-pagar/service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json();
    const conta = await contasService.anexarDocumento(id, body);
    return NextResponse.json(conta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao atualizar conta";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await contasService.deletar(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao remover conta";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
