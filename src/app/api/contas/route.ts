import { NextResponse } from "next/server";
import { contasService } from "@/modules/contas-a-pagar/service";
import { contasFixasService } from "@/modules/contas-fixas/service";
import { requireRole, requireSession, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";

export async function GET(req: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(req.url);
    const filtros = Object.fromEntries(searchParams.entries());
    // Garante (idempotente) que as parcelas de contas fixas do MÊS ATUAL
    // existam em Contas a Pagar — sem depender de abrir a Agenda antes.
    // Histórico pago retroativo só via backfill explícito (ADMIN/FINANCEIRO).
    try {
      await contasFixasService.garantirOcorrencias(
        resolverPeriodo(PeriodoPreset.MES_ATUAL),
      );
    } catch (genErr) {
      logger.warn(
        { err: genErr },
        "[contas:list] falha ao gerar ocorrências de contas fixas",
      );
    }
    const contas = await contasService.listar(filtros);
    return NextResponse.json(contas);
  } catch (e) {
    if (e instanceof Response) return e;
    logger.error({ err: e }, "[contas:list] falha");
    return NextResponse.json({ error: "falha ao listar contas" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireRole(UsuarioRole.ADMIN, UsuarioRole.FINANCEIRO);
    const body = await req.json();
    const conta = await contasService.criar(body);
    return NextResponse.json(conta, { status: 201 });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao criar conta";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
