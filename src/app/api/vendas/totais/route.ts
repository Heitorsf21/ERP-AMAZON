import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import {
  dataVendaPeriodoSP,
  normalizarVisaoVendas,
  whereVendaAmazonEspelhoGestorSeller,
  whereVendaAmazonPorVisao,
} from "@/modules/vendas/filtros";
import { separarVendasReembolsadas } from "@/modules/dashboard-ecommerce/reembolso-faturamento";
import { chaveVendaReembolso } from "@/modules/dashboard-ecommerce/reembolso-faturamento";
import { valorBrutoDaVenda } from "@/modules/vendas/valores";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireRole(UsuarioRole.OPERADOR);
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

    // Visão DEFAULT (principal, sem chips de status): usa a MESMA definição do
    // card Faturamento do dashboard — base EspelhoGestorSeller + remoção apenas
    // das vendas TOTALMENTE reembolsadas cujo AmazonReembolso caiu DENTRO da
    // janela. Antes, os KPIs daqui excluíam reembolsadas para sempre e os dois
    // lugares mostravam números diferentes para o mesmo período. Com visão ou
    // status explícitos, mantém o recorte deliberado do usuário.
    const alinharComDashboard = visao === "principal" && statusesArr.length === 0;
    const where = alinharComDashboard
      ? whereVendaAmazonEspelhoGestorSeller(filtros)
      : whereVendaAmazonPorVisao(visao, filtros);

    const [vendasBase, ultimaImportacao] = await Promise.all([
      db.vendaAmazon.findMany({
        where,
        select: {
          amazonOrderId: true,
          sku: true,
          quantidade: true,
          precoUnitarioCentavos: true,
          valorBrutoCentavos: true,
          statusPedido: true,
          statusFinanceiro: true,
        },
      }),
      db.amazonSyncLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, tipo: true, mensagem: true },
      }),
    ]);

    let vendas = vendasBase;
    if (alinharComDashboard) {
      const dataVenda = filtros.dataVenda as
        | { gte?: Date; lte?: Date }
        | undefined;
      const reembolsos = await db.amazonReembolso.findMany({
        where: dataVenda
          ? { dataReembolso: { gte: dataVenda.gte, lte: dataVenda.lte } }
          : {},
        select: { amazonOrderId: true, sku: true },
      });
      const reembolsoKeys = new Set(
        reembolsos
          .filter((r) => r.sku)
          .map((r) =>
            chaveVendaReembolso({
              amazonOrderId: r.amazonOrderId,
              sku: r.sku as string,
            }),
          ),
      );
      vendas = separarVendasReembolsadas(vendasBase, reembolsoKeys).faturaveis;
    }

    const receitaBrutaCentavos = vendas.reduce(
      (acc, venda) => acc + valorBrutoDaVenda(venda),
      0,
    );
    const unidadesVendidas = vendas.reduce(
      (acc, venda) => acc + venda.quantidade,
      0,
    );
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
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "[GET /api/vendas/totais] falha");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
