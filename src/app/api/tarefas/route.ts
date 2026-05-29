import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { tarefasService } from "@/modules/tarefas/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const tarefa = await tarefasService.criar(body, session.uid);
    return NextResponse.json(tarefa, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao criar tarefa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
