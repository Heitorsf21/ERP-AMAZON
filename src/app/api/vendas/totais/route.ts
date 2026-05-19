import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import {
  dataVendaPeriodoSP,
  normalizarVisaoVendas,
  whereVendaAmazonPorVisao,
} from "@/modules/vendas/filtros";
import { valorBrutoDaVenda } from "@/modules/vendas/valores";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const preset = searchParams.get("preset");
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const sku = searchParams.get("sku");
    const status = searchParams.get("status");
    const statusesRaw = searchParams.get("statuses");
    const logistica = searchParams.get("logistica");
    const visao = normalizarVisaoVendas(searchParams.get("visao"));

    const filtros: Prisma.VendaAmazonWhereInput = {};

    // Período — mesmo bloco que `/api/vendas`, para que KPIs reflitam
    // o mesmo recorte que a lista.
    if (preset && preset !== PeriodoPreset.PERSONALIZADO) {
      const intervalo = resolverPeriodo(preset);
      filtros.dataVenda = { gte: intervalo.de, lte: intervalo.ate };
    } else if (preset === PeriodoPreset.PERSONALIZADO && de && ate) {
      const intervalo = resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);
      filtros.dataVenda = { gte: intervalo.de, lte: intervalo.ate };
    } else {
      const dataVenda = dataVendaPeriodoSP(de, ate);
      if (dataVenda) filtros.dataVenda = dataVenda;
    }

    if (sku) filtros.sku = { contains: sku };
    if (logistica) filtros.fulfillmentChannel = logistica;

    const statusesArr = statusesRaw
      ? statusesRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : status && status !== "todos"
        ? [status]
        : [];
    if (statusesArr.length > 0) {
      filtros.OR = statusesArr.flatMap((s) => [
        { statusPedido: s },
        { statusFinanceiro: s },
      ]);
    }

    const where = whereVendaAmazonPorVisao(visao, filtros);

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
      (acc, venda) => acc + valorBrutoDaVenda(venda),
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
