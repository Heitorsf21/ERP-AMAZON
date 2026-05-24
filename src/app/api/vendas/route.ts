import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { PeriodoPreset, resolverPeriodo } from "@/lib/periodo";
import { montarBreakdownVendas } from "@/modules/vendas/breakdown";
import {
  dataVendaPeriodoSP,
  normalizarVisaoVendas,
  whereVendaAmazonPorVisao,
} from "@/modules/vendas/filtros";
import { buildCategoriaTaxaEstimada } from "@/modules/vendas/taxas-estimadas";
import { loadFeeEstimatorConfig } from "@/modules/produtos/fee-estimator";
import { valorBrutoDaVenda } from "@/modules/vendas/valores";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const inicio = Date.now();
  try {
    await requireRole(UsuarioRole.OPERADOR);
    const { searchParams } = req.nextUrl;
    const preset = searchParams.get("preset");
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const sku = searchParams.get("sku");
    const status = searchParams.get("status"); // legado, single value
    const statusesRaw = searchParams.get("statuses"); // novo, CSV
    const logistica = searchParams.get("logistica");
    const visao = normalizarVisaoVendas(searchParams.get("visao"));
    const pagina = Math.max(1, Number(searchParams.get("pagina") ?? "1"));
    const porPagina = 50;

    const filtros: Prisma.VendaAmazonWhereInput = {};

    // Período: preset tem prioridade sobre de/ate cru
    if (preset && preset !== PeriodoPreset.PERSONALIZADO) {
      const intervalo = resolverPeriodo(preset);
      filtros.dataVenda = {
        gte: intervalo.de,
        lte: intervalo.ate,
      };
    } else if (preset === PeriodoPreset.PERSONALIZADO && de && ate) {
      const intervalo = resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);
      filtros.dataVenda = {
        gte: intervalo.de,
        lte: intervalo.ate,
      };
    } else {
      const dataVenda = dataVendaPeriodoSP(de, ate);
      if (dataVenda) filtros.dataVenda = dataVenda;
    }

    if (sku) {
      filtros.sku = { contains: sku };
    }
    if (logistica) {
      filtros.fulfillmentChannel = logistica;
    }

    // Status pode vir como CSV (novo) ou single value (legado)
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

    // Breakdown inline (substitui enriquecerVendasComTaxasEstimadas).
    // Uma única passagem batch: ≤4 queries Prisma independente do tamanho.
    const { breakdownPorVenda, produtoPorSku } = await montarBreakdownVendas(vendas);

    // Config do estimador (cache 60s) — usada apenas para o label de
    // categoria do filtro legado `categoriaTaxaEstimada`.
    const cfgFee = await loadFeeEstimatorConfig();

    const vendasFormatadas = vendas.map((venda) => {
      const breakdown = breakdownPorVenda.get(venda.id);
      const produto = produtoPorSku.get(venda.sku) ?? null;
      const taxasEstimadas = breakdown?.origem === "estimated";
      const categoriaTaxaEstimada = taxasEstimadas
        ? buildCategoriaTaxaEstimada(
            breakdown?.categoriaTaxaSlug ?? null,
            cfgFee.referralDefaultBps,
          )
        : undefined;

      return {
        ...venda,
        numeroPedido: venda.amazonOrderId,
        status: venda.statusPedido,
        dataCompra: venda.dataVenda,
        skuExterno: venda.sku,
        totalCentavos: valorBrutoDaVenda(venda),
        breakdown,
        taxasEstimadas,
        categoriaTaxaEstimada,
        // Enriquecimento de produto vindo da mesma passagem batch:
        produtoImagemUrl: resolverImagemProduto(
          produto?.amazonImagemUrl ?? null,
          produto?.amazonAsin ?? venda.asin,
          produto?.imagemUrl ?? null,
        ),
        produtoAsin: produto?.amazonAsin ?? venda.asin,
      };
    });

    logger.info(
      {
        pageDurationMs: Date.now() - inicio,
        vendaCount: vendas.length,
        visao,
        pagina,
      },
      "api vendas list",
    );

    return NextResponse.json({
      vendas: vendasFormatadas,
      total,
      pagina,
      porPagina,
    });
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "api vendas list error");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
