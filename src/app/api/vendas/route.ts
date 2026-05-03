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
    const sku = searchParams.get("sku");
    const status = searchParams.get("status");
    const pagina = Math.max(1, Number(searchParams.get("pagina") ?? "1"));
    const porPagina = 50;

    const filtros: Prisma.VendaAmazonWhereInput = {};

    const dataVenda = dataVendaPeriodoSP(de, ate);
    if (dataVenda) filtros.dataVenda = dataVenda;
    if (sku) {
      filtros.sku = { contains: sku };
    }
    if (status && status !== "todos") {
      filtros.OR = [{ statusPedido: status }, { statusFinanceiro: status }];
    }
    const where =
      status && status !== "todos"
        ? filtros
        : whereVendaAmazonContabilizavel(filtros);

    const [total, vendas] = await Promise.all([
      db.vendaAmazon.count({ where }),
      db.vendaAmazon.findMany({
        where,
        orderBy: { dataVenda: "desc" },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          amazonOrderId: true,
          orderItemId: true,
          marketplace: true,
          statusPedido: true,
          statusFinanceiro: true,
          dataVenda: true,
          sku: true,
          asin: true,
          titulo: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          valorBrutoCentavos: true,
          taxasCentavos: true,
          fretesCentavos: true,
          liquidoMarketplaceCentavos: true,
          custoUnitarioCentavos: true,
          liquidacaoId: true,
          fulfillmentChannel: true,
          ultimaSyncEm: true,
        },
      }),
    ]);

    const vendasFormatadas = vendas.map((venda) => ({
      ...venda,
      numeroPedido: venda.amazonOrderId,
      status: venda.statusPedido,
      dataCompra: venda.dataVenda,
      skuExterno: venda.sku,
      totalCentavos:
        venda.valorBrutoCentavos ??
        venda.precoUnitarioCentavos * venda.quantidade,
    }));

    return NextResponse.json({
      vendas: vendasFormatadas,
      total,
      pagina,
      porPagina,
    });
  } catch (err) {
    console.error("[GET /api/vendas]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
