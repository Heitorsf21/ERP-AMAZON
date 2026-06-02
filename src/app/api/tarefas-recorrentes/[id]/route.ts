import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { tarefasService } from "@/modules/tarefas/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const molde = await tarefasService.atualizarRecorrente(id, body, session.uid);
    return NextResponse.json(molde);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao atualizar recorrência";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const resultado = await tarefasService.desativarRecorrente(id, session.uid);
    return NextResponse.json(resultado);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao remover recorrência";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
