import { NextResponse } from "next/server";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { contasFixasService } from "@/modules/contas-fixas/service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    await requireRole(UsuarioRole.ADMIN, UsuarioRole.FINANCEIRO);
    const { id } = await params;
    const body = await req.json();
    const conta = await contasFixasService.atualizar(id, body);
    return NextResponse.json(conta);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao atualizar conta fixa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await requireRole(UsuarioRole.ADMIN, UsuarioRole.FINANCEIRO);
    const { id } = await params;
    await contasFixasService.desativar(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao remover conta fixa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
