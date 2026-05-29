import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { tarefasService } from "@/modules/tarefas/service";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const tarefa = await tarefasService.atualizar(id, body, session.uid);
    return NextResponse.json(tarefa);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao atualizar tarefa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    await tarefasService.excluir(id, session.uid);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao remover tarefa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
