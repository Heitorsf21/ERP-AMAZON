import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  dataVendaPeriodoSP,
  whereVendaAmazonContabilizavel,
} from "@/modules/vendas/filtros";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");

    const filtros: Prisma.VendaAmazonWhereInput = {};

    const dataVenda = dataVendaPeriodoSP(de, ate);
    if (dataVenda) filtros.dataVenda = dataVenda;

    const where = whereVendaAmazonContabilizavel(filtros);

    const [vendas, agg, ultimaImportacao] = await Promise.all([
      db.vendaAmazon.findMany({
        where,
        select: {
          amazonOrderId: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          valorBrutoCentavos: true,
        },
      }),
      db.vendaAmazon.aggregate({
        where,
        _sum: { quantidade: true },
      }),
      db.amazonSyncLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, tipo: true, mensagem: true },
      }),
    ]);

    const receitaBrutaCentavos = vendas.reduce(
      (acc, venda) =>
        acc +
        (venda.valorBrutoCentavos ??
          venda.precoUnitarioCentavos * venda.quantidade),
      0,
    );
    const unidadesVendidas = agg._sum.quantidade ?? 0;
    const quantidadePedidos = new Set(vendas.map((venda) => venda.amazonOrderId))
      .size;
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
