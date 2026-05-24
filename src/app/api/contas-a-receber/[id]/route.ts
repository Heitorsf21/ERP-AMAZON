import { NextResponse } from "next/server";
import { contasReceberService } from "@/modules/contas-a-receber/service";
import { requireRole, UsuarioRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await requireRole(UsuarioRole.ADMIN, UsuarioRole.FINANCEIRO);
    const { id } = await params;
    await contasReceberService.deletar(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao remover conta a receber";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
