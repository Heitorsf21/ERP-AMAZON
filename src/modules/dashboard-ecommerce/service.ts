import { addDays, format, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { TIMEZONE } from "@/lib/date";
import {
  formatarDiaPeriodo,
  type IntervaloPeriodo,
} from "@/lib/periodo";
import {
  converterParaReembolsosAmazon,
  converterParaVendasAmazon,
  parseAmazonUnifiedTransactionCsv,
} from "@/integrations/amazon/unified-transactions";
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";
import {
  calcularValoresLinhaVendaAmazon,
  valorBrutoDaVenda,
} from "@/modules/vendas/valores";

type VendaDashboard = {
  amazonOrderId: string;
  sku: string;
  titulo: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number | null;
  taxasCentavos: number;
  fretesCentavos: number;
  custoUnitarioCentavos: number | null;
  dataVenda: Date;
};

type GastoManual = {
  id: string;
  periodoInicio: Date;
  periodoFim: Date;
  produtoId: string | null;
  valorCentavos: number;
};

export type ResultadoImportacaoVendaAmazon = {
  lidas: number;
  criadas: number;
  atualizadas: number;
  reembolsosCriados: number;
  reembolsosAtualizados: number;
  ignoradas: number;
};

export const dashboardEcommerceService = {
  async importarVendasAmazonCSV(
    conteudo: string,
  ): Promise<ResultadoImportacaoVendaAmazon> {
    const { transactions } = parseAmazonUnifiedTransactionCsv(conteudo);
    const vendas = converterParaVendasAmazon(transactions);
    const reembolsos = converterParaReembolsosAmazon(transactions);
    const skus = [
      ...new Set(
        [...vendas, ...reembolsos].map((item) => item.sku).filter(Boolean),
      ),
    ];
    const produtos = await db.produto.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true, asin: true, custoUnitario: true },
    });
    const produtosPorSku = new Map(produtos.map((produto) => [produto.sku, produto]));

    const resultado: ResultadoImportacaoVendaAmazon = {
      lidas: vendas.length,
      criadas: 0,
      atualizadas: 0,
      reembolsosCriados: 0,
      reembolsosAtualizados: 0,
      ignoradas: 0,
    };

    for (const venda of vendas) {
      if (!venda.amazonOrderId || !venda.sku || venda.quantidade <= 0) {
        resultado.ignoradas += 1;
        continue;
      }

      const produto = produtosPorSku.get(venda.sku);
      const custoUnitarioCentavos =
        produto?.custoUnitario && produto.custoUnitario > 0
          ? produto.custoUnitario
          : null;
      const where = {
        amazonOrderId_sku: {
          amazonOrderId: venda.amazonOrderId,
          sku: venda.sku,
        },
      };
      const existente = await db.vendaAmazon.findUnique({ where });

      const valores = calcularValoresLinhaVendaAmazon({
        quantidade: venda.quantidade,
        valorBrutoCentavos:
          venda.valorBrutoCentavos ??
          venda.precoUnitarioCentavos * venda.quantidade,
        taxasCentavos: venda.taxasCentavos,
        fretesCentavos: venda.fretesCentavos,
        liquidoMarketplaceCentavos: venda.liquidoMarketplaceCentavos,
      });

      const data = {
        asin: venda.asin ?? produto?.asin ?? null,
        titulo: venda.titulo ?? null,
        quantidade: valores.quantidade,
        precoUnitarioCentavos: valores.precoUnitarioCentavos,
        valorBrutoCentavos: valores.valorBrutoCentavos,
        taxasCentavos: valores.taxasCentavos,
        fretesCentavos: valores.fretesCentavos,
        liquidoMarketplaceCentavos: valores.liquidoMarketplaceCentavos,
        liquidacaoId: venda.liquidacaoId ?? null,
        fulfillmentChannel: venda.fulfillmentChannel ?? null,
        statusPedido: venda.statusPedido ?? "ORDERED",
        statusFinanceiro: venda.statusFinanceiro ?? "IMPORTADO",
        marketplace: venda.marketplace,
        dataVenda: venda.dataVenda,
        ultimaSyncEm: new Date(),
      };

      if (existente) {
        await db.vendaAmazon.update({
          where: { id: existente.id },
          data,
        });
        resultado.atualizadas += 1;
      } else {
        await db.vendaAmazon.create({
          data: {
            amazonOrderId: venda.amazonOrderId,
            sku: venda.sku,
            ...data,
            custoUnitarioCentavos,
          },
        });
        resultado.criadas += 1;
      }
    }

    for (const reembolso of reembolsos) {
      if (!reembolso.amazonOrderId || !reembolso.sku) {
        resultado.ignoradas += 1;
        continue;
      }

      const produto = produtosPorSku.get(reembolso.sku);
      const existente = await db.amazonReembolso.findUnique({
        where: { referenciaExterna: reembolso.referenciaExterna },
      });
      const data = {
        amazonOrderId: reembolso.amazonOrderId,
        orderItemId: reembolso.orderItemId ?? null,
        sku: reembolso.sku,
        asin: reembolso.asin ?? produto?.asin ?? null,
        titulo: reembolso.titulo ?? null,
        quantidade: reembolso.quantidade,
        valorReembolsadoCentavos: reembolso.valorReembolsadoCentavos,
        taxasReembolsadasCentavos: reembolso.taxasReembolsadasCentavos ?? 0,
        dataReembolso: reembolso.dataReembolso,
        liquidacaoId: reembolso.liquidacaoId ?? null,
        marketplace: reembolso.marketplace ?? null,
        statusFinanceiro: reembolso.statusFinanceiro ?? "IMPORTADO",
        produtoId: produto?.id ?? null,
      };

      if (existente) {
        await db.amazonReembolso.update({
          where: { id: existente.id },
          data,
        });
        resultado.reembolsosAtualizados += 1;
      } else {
        await db.amazonReembolso.create({
          data: {
            ...data,
            referenciaExterna: reembolso.referenciaExterna,
          },
        });
        resultado.reembolsosCriados += 1;
      }

      await db.vendaAmazon.updateMany({
        where: {
          amazonOrderId: reembolso.amazonOrderId,
          sku: reembolso.sku,
        },
        data: {
          statusPedido: "REEMBOLSADO",
          statusFinanceiro: "REEMBOLSADO",
          ultimaSyncEm: new Date(),
        },
      });
    }

    return resultado;
  },

  async obterKpis(periodo: IntervaloPeriodo) {
    const [vendas, ads, traffic] = await Promise.all([
      buscarVendas(periodo),
      fetchAdsGasto(periodo),
      buscarTraffic(periodo),
    ]);
    const agregado = agregarVendas(vendas);
    const lucroBrutoCentavos = calcularLucroBruto(agregado);
    const lucroPosAdsCentavos =
      lucroBrutoCentavos == null
        ? null
        : lucroBrutoCentavos - ads.totalCentavos;

    return {
      periodo,
      faturamentoCentavos: agregado.faturamentoCentavos,
      liquidoMarketplaceCentavos: agregado.liquidoMarketplaceCentavos,
      lucroBrutoCentavos,
      margemPercentual: percentual(lucroBrutoCentavos, agregado.faturamentoCentavos),
      numeroVendas: agregado.numeroVendas,
      unidades: agregado.unidades,
      ticketMedioCentavos:
        agregado.numeroVendas > 0
          ? Math.round(agregado.faturamentoCentavos / agregado.numeroVendas)
          : 0,
      roiPercentual: percentual(lucroBrutoCentavos, agregado.custoTotalCentavos),
      valorAdsCentavos: ads.totalCentavos,
      tacosPercentual: percentual(ads.totalCentavos, agregado.faturamentoCentavos),
      lucroPosAdsCentavos,
      mpaPercentual: percentual(lucroPosAdsCentavos, agregado.faturamentoCentavos),
      roiPosAdsPercentual: percentual(
        lucroPosAdsCentavos,
        agregado.custoTotalCentavos,
      ),
      trafficSessions: traffic.sessions,
      trafficPageViews: traffic.pageViews,
      trafficUnitsOrdered: traffic.unitsOrdered,
      trafficRevenueOrderedCentavos: traffic.revenueOrderedCentavos,
      trafficConversionPercent: percentual(traffic.unitsOrdered, traffic.sessions),
      trafficBuyBoxPercent: traffic.buyBoxPercent,
      custoTotalCentavos: agregado.custoCompleto
        ? agregado.custoTotalCentavos
        : null,
      vendasSemCusto: agregado.vendasSemCusto,
    };
  },

  async obterTimeline(periodo: IntervaloPeriodo) {
    const [vendas, ads] = await Promise.all([
      buscarVendas(periodo),
      fetchAdsGasto(periodo),
    ]);
    const agregado = agregarVendas(vendas);
    const porDia = new Map<string, VendaDashboard[]>();

    for (const venda of vendas) {
      const dia = formatarDiaPeriodo(venda.dataVenda);
      porDia.set(dia, [...(porDia.get(dia) ?? []), venda]);
    }

    return criarDiasDoPeriodo(periodo).map((dia) => {
      const vendasDoDia = porDia.get(dia) ?? [];
      const item = agregarVendas(vendasDoDia);
      const lucroBrutoCentavos = calcularLucroBruto(item);
      const adsDoDia =
        agregado.faturamentoCentavos > 0
          ? Math.round(
              ads.totalCentavos *
                (item.faturamentoCentavos / agregado.faturamentoCentavos),
            )
          : 0;

      return {
        data: dia,
        faturamentoCentavos: item.faturamentoCentavos,
        lucroBrutoCentavos,
        lucroPosAdsCentavos:
          lucroBrutoCentavos == null ? null : lucroBrutoCentavos - adsDoDia,
      };
    });
  },

  async obterTopProdutos(periodo: IntervaloPeriodo, limit = 15) {
    const [vendas, ads] = await Promise.all([
      buscarVendas(periodo),
      buscarGastosManuais(periodo),
    ]);
    const totalFaturamento = vendas.reduce(
      (acc, venda) => acc + faturamentoDaVenda(venda),
      0,
    );
    const mapaSkuAgrupador = await carregarMapaSkuAgrupador(
      vendas.map((venda) => venda.sku),
    );
    const porSku = new Map<string, VendaDashboard[]>();

    for (const venda of vendas) {
      const sku = mapaSkuAgrupador.get(venda.sku) ?? venda.sku;
      porSku.set(sku, [...(porSku.get(sku) ?? []), venda]);
    }

    const produtos = await db.produto.findMany({
      where: { sku: { in: [...porSku.keys()] } },
      select: { id: true, sku: true, nome: true, custoUnitario: true },
    });
    const produtosPorSku = new Map(produtos.map((produto) => [produto.sku, produto]));
    const adsGeral = ads
      .filter((gasto) => !gasto.produtoId)
      .reduce((acc, gasto) => acc + valorSobreposto(gasto, periodo), 0);
    const adsPorProduto = new Map<string, number>();

    for (const gasto of ads) {
      if (!gasto.produtoId) continue;
      adsPorProduto.set(
        gasto.produtoId,
        (adsPorProduto.get(gasto.produtoId) ?? 0) +
          valorSobreposto(gasto, periodo),
      );
    }

    return [...porSku.entries()]
      .map(([sku, vendasDoProduto]) => {
        const produto = produtosPorSku.get(sku);
        const agregado = agregarVendas(vendasDoProduto);
        const lucroBrutoCentavos = calcularLucroBruto(agregado);
        const adsRateadoCentavos =
          (produto?.id ? adsPorProduto.get(produto.id) ?? 0 : 0) +
          (totalFaturamento > 0
            ? Math.round(
                adsGeral *
                  (agregado.faturamentoCentavos / totalFaturamento),
              )
            : 0);
        const lucroPosAdsCentavos =
          lucroBrutoCentavos == null
            ? null
            : lucroBrutoCentavos - adsRateadoCentavos;

        return {
          sku,
          produtoId: produto?.id ?? null,
          nome: nomeProdutoDashboard(produto?.nome, sku, vendasDoProduto),
          precoMedioCentavos:
            agregado.unidades > 0
              ? Math.round(agregado.faturamentoCentavos / agregado.unidades)
              : 0,
          custoUnitarioCentavos: agregado.custoCompleto
            ? Math.round(agregado.custoTotalCentavos / Math.max(1, agregado.unidades))
            : null,
          unidades: agregado.unidades,
          faturadoCentavos: agregado.faturamentoCentavos,
          representatividadePercentual: percentual(
            agregado.faturamentoCentavos,
            totalFaturamento,
          ),
          lucroCentavos: lucroBrutoCentavos,
          margemPercentual: percentual(
            lucroBrutoCentavos,
            agregado.faturamentoCentavos,
          ),
          custoAdsCentavos: adsRateadoCentavos,
          lucroPosAdsCentavos,
          mpaPercentual: percentual(
            lucroPosAdsCentavos,
            agregado.faturamentoCentavos,
          ),
        };
      })
      .sort((a, b) => b.faturadoCentavos - a.faturadoCentavos)
      .slice(0, limit);
  },

  listarAdsGastoManual(periodo: IntervaloPeriodo) {
    return db.adsGastoManual.findMany({
      where: {
        periodoInicio: { lte: periodo.ate },
        periodoFim: { gte: periodo.de },
      },
      include: {
        produto: {
          select: { id: true, sku: true, nome: true },
        },
      },
      orderBy: { criadoEm: "desc" },
    });
  },

  criarAdsGastoManual(input: {
    periodoInicio: Date;
    periodoFim: Date;
    produtoId?: string | null;
    valorCentavos: number;
  }) {
    return db.adsGastoManual.create({
      data: {
        periodoInicio: input.periodoInicio,
        periodoFim: input.periodoFim,
        produtoId: input.produtoId || null,
        valorCentavos: input.valorCentavos,
      },
    });
  },
};

export async function fetchAdsGasto(periodo: IntervaloPeriodo) {
  const gastos = await buscarGastosManuais(periodo);
  return {
    totalCentavos: gastos.reduce(
      (acc, gasto) => acc + valorSobreposto(gasto, periodo),
      0,
    ),
    fonte: "manual" as const,
  };
}

async function buscarVendas(periodo: IntervaloPeriodo): Promise<VendaDashboard[]> {
  return db.vendaAmazon.findMany({
    where: whereVendaAmazonContabilizavel({
      dataVenda: {
        gte: periodo.de,
        lte: periodo.ate,
      },
    }),
    select: {
      amazonOrderId: true,
      sku: true,
      titulo: true,
      quantidade: true,
      precoUnitarioCentavos: true,
      valorBrutoCentavos: true,
      taxasCentavos: true,
      fretesCentavos: true,
      custoUnitarioCentavos: true,
      dataVenda: true,
    },
  });
}

async function carregarMapaSkuAgrupador(skus: string[]) {
  const unicos = [...new Set(skus.filter(Boolean))];
  if (unicos.length === 0) return new Map<string, string>();

  const variacoes = await db.produtoVariacao.findMany({
    where: { skuFilho: { in: unicos } },
    select: { skuPai: true, skuFilho: true },
  });

  return new Map(
    variacoes
      .filter((variacao) => variacao.skuFilho)
      .map((variacao) => [variacao.skuFilho as string, variacao.skuPai]),
  );
}

function nomeProdutoDashboard(
  nomeProduto: string | null | undefined,
  sku: string,
  vendas: VendaDashboard[],
) {
  const nomeLimpo = nomeProduto?.trim();
  if (nomeLimpo && nomeLimpo !== sku) return nomeLimpo;

  return vendas.find((venda) => venda.titulo?.trim())?.titulo ?? sku;
}

function buscarGastosManuais(periodo: IntervaloPeriodo): Promise<GastoManual[]> {
  return db.adsGastoManual.findMany({
    where: {
      periodoInicio: { lte: periodo.ate },
      periodoFim: { gte: periodo.de },
    },
    select: {
      id: true,
      periodoInicio: true,
      periodoFim: true,
      produtoId: true,
      valorCentavos: true,
    },
  });
}

async function buscarTraffic(periodo: IntervaloPeriodo) {
  const agregado = await db.amazonSkuTrafficDaily.aggregate({
    where: {
      data: {
        gte: periodo.de,
        lte: periodo.ate,
      },
    },
    _sum: {
      sessoes: true,
      pageViews: true,
      unitsOrdered: true,
      orderedRevenueCentavos: true,
    },
    _avg: {
      buyBoxPercent: true,
    },
  });

  return {
    sessions: agregado._sum?.sessoes ?? 0,
    pageViews: agregado._sum?.pageViews ?? 0,
    unitsOrdered: agregado._sum?.unitsOrdered ?? 0,
    revenueOrderedCentavos: agregado._sum?.orderedRevenueCentavos ?? 0,
    buyBoxPercent:
      agregado._avg?.buyBoxPercent == null
        ? null
        : Math.round(agregado._avg.buyBoxPercent * 10) / 10,
  };
}

function agregarVendas(vendas: VendaDashboard[]) {
  const pedidos = new Set(vendas.map((venda) => venda.amazonOrderId));
  let faturamentoCentavos = 0;
  let taxasCentavos = 0;
  let fretesCentavos = 0;
  let custoTotalCentavos = 0;
  let vendasSemCusto = 0;
  let unidades = 0;

  for (const venda of vendas) {
    faturamentoCentavos += faturamentoDaVenda(venda);
    taxasCentavos += venda.taxasCentavos;
    fretesCentavos += venda.fretesCentavos;
    unidades += venda.quantidade;

    if (venda.custoUnitarioCentavos && venda.custoUnitarioCentavos > 0) {
      custoTotalCentavos += venda.custoUnitarioCentavos * venda.quantidade;
    } else {
      vendasSemCusto += 1;
    }
  }

  return {
    faturamentoCentavos,
    taxasCentavos,
    fretesCentavos,
    liquidoMarketplaceCentavos:
      faturamentoCentavos - taxasCentavos - fretesCentavos,
    custoTotalCentavos,
    custoCompleto: vendasSemCusto === 0,
    vendasSemCusto,
    unidades,
    numeroVendas: pedidos.size,
  };
}

function calcularLucroBruto(agregado: ReturnType<typeof agregarVendas>) {
  if (!agregado.custoCompleto) return null;
  return agregado.liquidoMarketplaceCentavos - agregado.custoTotalCentavos;
}

function faturamentoDaVenda(venda: VendaDashboard): number {
  return valorBrutoDaVenda(venda);
}

function percentual(
  numerador: number | null,
  denominador: number | null,
): number | null {
  if (numerador == null || !denominador || denominador <= 0) return null;
  return (numerador / denominador) * 100;
}

function criarDiasDoPeriodo(periodo: IntervaloPeriodo): string[] {
  const dias: string[] = [];
  let cursor = startOfDay(toZonedTime(periodo.de, TIMEZONE));
  const fim = startOfDay(toZonedTime(periodo.ate, TIMEZONE));

  while (cursor.getTime() <= fim.getTime()) {
    dias.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 1);
  }

  return dias;
}

function valorSobreposto(gasto: GastoManual, periodo: IntervaloPeriodo) {
  const inicio = Math.max(
    gasto.periodoInicio.getTime(),
    periodo.de.getTime(),
  );
  const fim = Math.min(gasto.periodoFim.getTime(), periodo.ate.getTime());

  if (fim < inicio) return 0;

  const duracaoGasto = Math.max(
    1,
    gasto.periodoFim.getTime() - gasto.periodoInicio.getTime(),
  );
  const duracaoSobreposta = Math.max(1, fim - inicio);

  return Math.round(gasto.valorCentavos * (duracaoSobreposta / duracaoGasto));
}
