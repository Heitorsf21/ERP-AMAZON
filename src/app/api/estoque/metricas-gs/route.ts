import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireRole(UsuarioRole.OPERADOR);

    const ultimoLote = await db.loteMetricaGS.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (!ultimoLote) {
      return NextResponse.json({ metricas: [], loteId: null, importadoEm: null });
    }

    const metricas = await db.produtoMetricaGestorSeller.findMany({
      where: { loteId: ultimoLote.id },
      include: {
        produto: {
          select: { estoqueAtual: true, asin: true, ativo: true },
        },
      },
      orderBy: { faturamentoCentavos: "desc" },
    });

    return NextResponse.json({
      metricas,
      loteId: ultimoLote.id,
      importadoEm: ultimoLote.createdAt,
    });
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "[estoque/metricas-gs] falha");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
