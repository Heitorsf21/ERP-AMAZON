import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { tarefasService } from "@/modules/tarefas/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const recorrentes = await tarefasService.listarRecorrentes(session.uid);
    return NextResponse.json(recorrentes);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao listar recorrências";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const molde = await tarefasService.criarRecorrente(body, session.uid);
    return NextResponse.json(molde, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao criar recorrência";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
