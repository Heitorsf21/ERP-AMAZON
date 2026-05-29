import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import { agendaService } from "@/modules/agenda/service";

export const dynamic = "force-dynamic";

function csv(valor: string | null): string[] {
  if (!valor) return [];
  return valor
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);

    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const preset = searchParams.get("preset");
    const periodo =
      de && ate
        ? resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate)
        : resolverPeriodo(preset ?? PeriodoPreset.MES_ATUAL);

    const resultado = await agendaService.listarPorPeriodo({
      usuarioId: session.uid,
      de: periodo.de,
      ate: periodo.ate,
      tipos: csv(searchParams.get("tipos")),
      status: csv(searchParams.get("status")),
    });

    return NextResponse.json({
      ...resultado,
      periodo: { de: periodo.de.toISOString(), ate: periodo.ate.toISOString() },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    logger.error({ err: e }, "[agenda:list] falha");
    return NextResponse.json({ error: "falha ao listar agenda" }, { status: 500 });
  }
}
