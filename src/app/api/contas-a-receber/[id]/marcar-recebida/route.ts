import { NextResponse } from "next/server";
import { contasReceberService } from "@/modules/contas-a-receber/service";
import { requireRole, UsuarioRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    await requireRole(UsuarioRole.FINANCEIRO);
    const { id } = await params;
    const conta = await contasReceberService.marcarRecebida(id);
    return NextResponse.json(conta);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao marcar como recebida";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
