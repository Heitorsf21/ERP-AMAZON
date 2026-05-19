import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolverImagemProduto } from "@/lib/amazon-images";
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
    const { searchParams } = req.nextUrl;
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");
    const sku = searchParams.get("sku");
    const status = searchParams.get("status");
    const visao = normalizarVisaoVendas(searchParams.get("visao"));
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
    logger.error({ err }, "api vendas list error");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
