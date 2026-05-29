import { NextResponse } from "next/server";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import { garantirOcorrenciasSchema } from "@/modules/contas-fixas/schemas";
import { contasFixasService } from "@/modules/contas-fixas/service";

export const dynamic = "force-dynamic";

/**
 * Materializa (idempotente) as ocorrências de contas fixas dentro de [de, ate].
 * Útil para pré-gerar lançamentos em Contas a Pagar de um intervalo específico.
 */
export async function POST(req: Request) {
  try {
    await requireRole(UsuarioRole.ADMIN, UsuarioRole.FINANCEIRO);
    const body = await req.json();
    const { de, ate } = garantirOcorrenciasSchema.parse(body);
    const periodo = resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);
    const resultado = await contasFixasService.garantirOcorrencias(periodo);
    return NextResponse.json(resultado);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "falha ao gerar ocorrências";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
