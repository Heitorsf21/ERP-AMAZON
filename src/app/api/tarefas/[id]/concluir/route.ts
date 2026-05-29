import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { tarefasService } from "@/modules/tarefas/service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const tarefa = await tarefasService.concluir(id, session.uid);
    return NextResponse.json(tarefa);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao concluir tarefa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
