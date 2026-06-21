import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import {
  whereAmazonReembolsoContabilizavel,
  whereVendaAmazonEspelhoGestorSeller,
} from "@/modules/vendas/filtros";
import { calcularResumoReembolsos } from "@/modules/vendas/reembolsos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireRole(UsuarioRole.OPERADOR);
    const { searchParams } = req.nextUrl;
    const preset = searchParams.get("preset");
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const sku = searchParams.get("sku");
    const pagina = Math.max(1, Number(searchParams.get("pagina") ?? "1"));
    const porPagina = 50;

    // Período: MESMO recorte das outras abas de Vendas (resolve o `preset`, não
    // só de/ate). Aplicado a `dataVenda` (denominador da taxa) E a
    // `dataReembolso` (numerador). Sem preset/intervalo válido => vitalício.
    let intervalo: { de: Date; ate: Date } | null = null;
    if (preset && preset !== PeriodoPreset.PERSONALIZADO) {
      intervalo = resolverPeriodo(preset);
    } else if (preset === PeriodoPreset.PERSONALIZADO && de && ate) {
      intervalo = resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);
    }

    // Denominador da taxa: pedidos REAIS vendidos no período. Usa o filtro
    // ESPELHO (não o estrito): precisa MANTER as vendas que depois viraram
    // REEMBOLSADO, senão a base fica subestimada e — pior — perderíamos o
    // vínculo com os próprios reembolsos.
    const filtrosVendas: Prisma.VendaAmazonWhereInput = {};
    if (intervalo)
      filtrosVendas.dataVenda = { gte: intervalo.de, lte: intervalo.ate };
    if (sku) filtrosVendas.sku = { contains: sku };
    const whereVendas = whereVendaAmazonEspelhoGestorSeller(filtrosVendas);

    // Numerador: reembolsos EFETIVADOS no período, buscados DIRETO por
    // `dataReembolso` — NUNCA por `amazonOrderId IN (vendas)`. Como a venda de
    // um pedido totalmente reembolsado fica com status REEMBOLSADO (e some dos
    // filtros de venda), filtrar reembolso por pedido-de-venda escondia ~todos
    // os reembolsos. `whereAmazonReembolsoContabilizavel` exclui os ainda não
    // liberados (DEFERRED/PENDENTE), igual ao resto do sistema.
    const filtrosReembolsos: Prisma.AmazonReembolsoWhereInput = {};
    if (intervalo)
      filtrosReembolsos.dataReembolso = { gte: intervalo.de, lte: intervalo.ate };
    if (sku) filtrosReembolsos.sku = { contains: sku };
    const whereReembolsos = whereAmazonReembolsoContabilizavel(filtrosReembolsos);

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

    const [reembolsos, totalPedidosReembolsados, todosReembolsosPeriodo] =
      await Promise.all([
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
        db.amazonReembolso.findMany({
          where: whereReembolsos,
          select: {
            amazonOrderId: true,
            sku: true,
            titulo: true,
            quantidade: true,
            valorReembolsadoCentavos: true,
          },
        }),
      ]);

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
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "[GET /api/vendas/reembolsos] falha");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
