import { NextResponse } from "next/server";
import { requireRole, requireSession, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { contasFixasService } from "@/modules/contas-fixas/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(req.url);
    const incluirInativas = searchParams.get("inativas") === "1";
    const contas = await contasFixasService.listar(incluirInativas);
    return NextResponse.json(contas);
  } catch (e) {
    if (e instanceof Response) return e;
    logger.error({ err: e }, "[contas-fixas:list] falha");
    return NextResponse.json(
      { error: "falha ao listar contas fixas" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireRole(UsuarioRole.ADMIN, UsuarioRole.FINANCEIRO);
    const body = await req.json();
    const conta = await contasFixasService.criar(body);
    return NextResponse.json(conta, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao criar conta fixa";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
