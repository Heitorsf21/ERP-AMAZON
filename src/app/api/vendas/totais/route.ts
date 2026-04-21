import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");

    const where: Prisma.VendaFBAWhereInput = {
      status: { notIn: ["Cancelado", "Reembolsado", "cancelado", "reembolsado"] },
    };

    if (de || ate) {
      where.dataCompra = {};
      if (de) where.dataCompra.gte = new Date(de);
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        where.dataCompra.lte = fim;
      }
    }

    const [agg, totalPedidos, ultimaImportacao] = await Promise.all([
      db.vendaFBA.aggregate({
        where,
        _sum: { totalCentavos: true, quantidade: true },
        _count: { id: true },
      }),
      db.vendaFBA.count({ where }),
      db.loteImportacaoFBA.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, tipo: true, nomeArquivo: true },
      }),
    ]);

    const receitaBrutaCentavos = agg._sum.totalCentavos ?? 0;
    const unidadesVendidas = agg._sum.quantidade ?? 0;
    const quantidadePedidos = totalPedidos;
    const ticketMedioCentavos =
      quantidadePedidos > 0
        ? Math.round(receitaBrutaCentavos / quantidadePedidos)
        : 0;

    return NextResponse.json({
      receitaBrutaCentavos,
      unidadesVendidas,
      quantidadePedidos,
      ticketMedioCentavos,
      ultimaImportacao,
    });
  } catch (err) {
    console.error("[GET /api/vendas/totais]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
