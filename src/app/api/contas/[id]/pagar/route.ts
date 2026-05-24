import { NextResponse } from "next/server";
import { contasService } from "@/modules/contas-a-pagar/service";
import { requireRole, UsuarioRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    await requireRole(UsuarioRole.FINANCEIRO);
    const { id } = await params;
    const body = await req.json();
    const conta = await contasService.marcarComoPaga(id, body);
    return NextResponse.json(conta);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao registrar pagamento";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
