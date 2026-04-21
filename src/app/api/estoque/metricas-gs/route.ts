import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
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
    console.error("[estoque/metricas-gs]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
