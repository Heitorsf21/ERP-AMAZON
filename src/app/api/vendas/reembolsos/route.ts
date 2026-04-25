import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calcularResumoReembolsos } from "@/modules/vendas/reembolsos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const sku = searchParams.get("sku");
    const pagina = Math.max(1, Number(searchParams.get("pagina") ?? "1"));
    const porPagina = 50;

    const whereVendas: Prisma.VendaAmazonWhereInput = {};
    if (de || ate) {
      whereVendas.dataVenda = {};
      if (de) whereVendas.dataVenda.gte = new Date(de);
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        whereVendas.dataVenda.lte = fim;
      }
    }
    if (sku) whereVendas.sku = { contains: sku };

    const vendas = await db.vendaAmazon.findMany({
      where: whereVendas,
      select: {
        amazonOrderId: true,
        sku: true,
        titulo: true,
        quantidade: true,
        precoUnitarioCentavos: true,
        valorBrutoCentavos: true,
        dataVenda: true,
      },
    });

    const orderIds = [...new Set(vendas.map((venda) => venda.amazonOrderId))];
    const whereReembolsos: Prisma.AmazonReembolsoWhereInput = {
      amazonOrderId: { in: orderIds.length > 0 ? orderIds : ["__sem_pedidos__"] },
    };
    if (sku) whereReembolsos.sku = { contains: sku };

    const [reembolsos, totalPedidosReembolsados] = await Promise.all([
      db.amazonReembolso.findMany({
        where: whereReembolsos,
        orderBy: { dataReembolso: "desc" },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          amazonOrderId: true,
          orderItemId: true,
          sku: true,
          asin: true,
          titulo: true,
          quantidade: true,
          valorReembolsadoCentavos: true,
          taxasReembolsadasCentavos: true,
          dataReembolso: true,
          liquidacaoId: true,
          marketplace: true,
          statusFinanceiro: true,
        },
      }),
      db.amazonReembolso.count({ where: whereReembolsos }),
    ]);

    const todosReembolsosPeriodo = await db.amazonReembolso.findMany({
      where: whereReembolsos,
      select: {
        amazonOrderId: true,
        sku: true,
        titulo: true,
        quantidade: true,
        valorReembolsadoCentavos: true,
      },
    });
    const produtos = calcularResumoReembolsos(vendas, todosReembolsosPeriodo);
    const pedidosVendidosUnicos = new Set(
      vendas.map((venda) => venda.amazonOrderId),
    ).size;
    const pedidosReembolsadosUnicos = new Set(
      todosReembolsosPeriodo.map((reembolso) => reembolso.amazonOrderId),
    ).size;
    const totais = {
      produtosAfetados: produtos.filter(
        (produto) => produto.pedidosReembolsados > 0,
      ).length,
      pedidosVendidos: pedidosVendidosUnicos,
      pedidosReembolsados: pedidosReembolsadosUnicos,
      taxaReembolso:
        pedidosVendidosUnicos > 0
          ? (pedidosReembolsadosUnicos / pedidosVendidosUnicos) * 100
          : 0,
      unidadesVendidas: produtos.reduce(
        (acc, produto) => acc + produto.unidadesVendidas,
        0,
      ),
      unidadesReembolsadas: produtos.reduce(
        (acc, produto) => acc + produto.unidadesReembolsadas,
        0,
      ),
      valorVendidoCentavos: produtos.reduce(
        (acc, produto) => acc + produto.valorVendidoCentavos,
        0,
      ),
      valorReembolsadoCentavos: produtos.reduce(
        (acc, produto) => acc + produto.valorReembolsadoCentavos,
        0,
      ),
    };

    return NextResponse.json({
      totais,
      produtos,
      pedidos: reembolsos,
      totalPedidosReembolsados,
      pagina,
      porPagina,
    });
  } catch (err) {
    console.error("[GET /api/vendas/reembolsos]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
