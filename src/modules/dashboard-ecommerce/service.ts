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
import {
  getAdsGastoPorProduto,
  getAdsResumo,
  getAdsTimeline,
  type FonteAds,
} from "@/modules/amazon/ads-aggregation";
import {
  whereVendaAmazonEspelhoGestorSeller,
} from "@/modules/vendas/filtros";
import {
  calcularImpostoSimplesCentavos,
  calcularValoresLinhaVendaAmazon,
  valorBrutoDaVenda,
} from "@/modules/vendas/valores";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import {
  findCommissionRule,
  formatCommissionRule,
} from "@/modules/produtos/commission-table";

type VendaDashboard = {
  amazonOrderId: string;
  sku: string;
  titulo: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number | null;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number | null;
  impostoSimplesCentavos: number;
  custoUnitarioCentavos: number | null;
  dataVenda: Date;
  statusFinanceiro?: string;
  taxasEstimadas?: boolean;
  categoriaTaxaEstimada?: {
    slug: string | null;
    label: string;
    regra: string;
  };
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
    const cfgImpostoSimples = await getConfigImpostoSimples();
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

      const statusPedidoFinal = venda.statusPedido ?? "ORDERED";
      const statusFinanceiroFinal = venda.statusFinanceiro ?? "IMPORTADO";
      const impostoSimplesCentavos = calcularImpostoSimplesCentavos({
        valorBrutoCentavos: valores.valorBrutoCentavos,
        aliquotaBps: cfgImpostoSimples.aliquotaBps,
        ativo: cfgImpostoSimples.ativo,
        statusPedido: statusPedidoFinal,
        statusFinanceiro: statusFinanceiroFinal,
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
        impostoSimplesCentavos,
        liquidacaoId: venda.liquidacaoId ?? null,
        fulfillmentChannel: venda.fulfillmentChannel ?? null,
        statusPedido: statusPedidoFinal,
        statusFinanceiro: statusFinanceiroFinal,
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
          impostoSimplesCentavos: 0,
          ultimaSyncEm: new Date(),
        },
      });
    }

    return resultado;
  },

  async obterKpis(periodo: IntervaloPeriodo) {
    const [vendasRaw, vendasReembolsadas, ads, traffic, cfgImpostoSimples] =
      await Promise.all([
        buscarVendas(periodo),
        buscarVendasReembolsadasGestorSeller(periodo),
        fetchAdsGasto(periodo),
        buscarTraffic(periodo),
        getConfigImpostoSimples(),
      ]);
    const vendas = await enriquecerComEstimativas(vendasRaw);
    const agregado = agregarVendas(vendas);
    const agregadoReembolsados = agregarVendas(vendasReembolsadas);
    const lucroBrutoCentavos = calcularLucroBruto(agregado);
    const lucroPosAdsCentavos =
      lucroBrutoCentavos == null
        ? null
        : lucroBrutoCentavos - ads.totalCentavos;

    return {
      periodo,
      faturamentoCentavos: agregado.faturamentoCentavos,
      freteCentavos: agregado.fretesCentavos,
      faturamentoComFreteCentavos:
        agregado.faturamentoCentavos + agregado.fretesCentavos,
      faturamentoReembolsadoCentavos: agregadoReembolsados.faturamentoCentavos,
      faturamentoComReembolsadosCentavos:
        agregado.faturamentoCentavos + agregadoReembolsados.faturamentoCentavos,
      liquidoMarketplaceCentavos: agregado.liquidoMarketplaceCentavos,
      impostoSimplesCentavos: agregado.impostoSimplesCentavos,
      impostoSimplesAliquotaBps: cfgImpostoSimples.aliquotaBps,
      impostoSimplesAtivo: cfgImpostoSimples.ativo,
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
      valorAdsFonte: ads.fonte,
      valorAdsParcial:
        ads.fonte === "STREAM" || ads.fonte === "MIXED_STREAM_SYNC",
      custoTotalCentavos: agregado.custoCompleto
        ? agregado.custoTotalCentavos
        : null,
      vendasSemCusto: agregado.vendasSemCusto,
      vendasComTaxaEstimada: vendas.filter((v) => v.taxasEstimadas).length,
      categoriasTaxaEstimada: resumirCategoriasTaxaEstimada(vendas),
      origemTaxas: deriveOrigemTaxas(vendas),
    };
  },

  async obterTimeline(periodo: IntervaloPeriodo) {
    const [vendasRaw, ads] = await Promise.all([
      buscarVendas(periodo),
      fetchAdsGasto(periodo),
    ]);
    const vendas = await enriquecerComEstimativas(vendasRaw);
    const agregado = agregarVendas(vendas);
    const porDia = new Map<string, VendaDashboard[]>();

    for (const venda of vendas) {
      const dia = formatarDiaPeriodo(venda.dataVenda);
      porDia.set(dia, [...(porDia.get(dia) ?? []), venda]);
    }

    // Quando ha sync de Ads (daily ou intraday stream), usamos o gasto REAL
    // por dia. Caso contrario, rateamos proporcionalmente ao faturamento —
    // granularidade legacy nao e diaria confiavel.
    const temDadoReal =
      ads.fonte === "SYNC" ||
      ads.fonte === "STREAM" ||
      ads.fonte === "MIXED_STREAM_SYNC";
    const adsRealPorDia = new Map<string, number>();
    if (temDadoReal) {
      const pontos = await getAdsTimeline(periodo, "day");
      for (const p of pontos) adsRealPorDia.set(p.data, p.gastoCentavos);
    }

    return criarDiasDoPeriodo(periodo).map((dia) => {
      const vendasDoDia = porDia.get(dia) ?? [];
      const item = agregarVendas(vendasDoDia);
      const lucroBrutoCentavos = calcularLucroBruto(item);
      const adsDoDia =
        temDadoReal
          ? (adsRealPorDia.get(dia) ?? 0)
          : agregado.faturamentoCentavos > 0
            ? Math.round(
                ads.totalCentavos *
                  (item.faturamentoCentavos / agregado.faturamentoCentavos),
              )
            : 0;

      return {
        data: dia,
        faturamentoCentavos: item.faturamentoCentavos,
        liquidoMarketplaceCentavos: item.liquidoMarketplaceCentavos,
        impostoSimplesCentavos: item.impostoSimplesCentavos,
        lucroBrutoCentavos,
        lucroPosAdsCentavos:
          lucroBrutoCentavos == null ? null : lucroBrutoCentavos - adsDoDia,
      };
    });
  },

  async obterTopProdutos(periodo: IntervaloPeriodo, limit = 15) {
    const [vendasRaw, adsPorProdutoInfo] = await Promise.all([
      buscarVendas(periodo),
      getAdsGastoPorProduto(periodo),
    ]);
    const vendas = await enriquecerComEstimativas(vendasRaw);
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
      select: {
        id: true,
        sku: true,
        nome: true,
        custoUnitario: true,
        imagemUrl: true,
        amazonImagemUrl: true,
        asin: true,
      },
    });
    const produtosPorSku = new Map(produtos.map((produto) => [produto.sku, produto]));
    const { porProdutoId: adsPorProduto, gastoSemProduto: adsGeral } =
      adsPorProdutoInfo;

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
          imagemUrl: produto?.imagemUrl ?? null,
          amazonImagemUrl: produto?.amazonImagemUrl ?? null,
          asin: produto?.asin ?? null,
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
          impostoSimplesCentavos: agregado.impostoSimplesCentavos,
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

export async function fetchAdsGasto(periodo: IntervaloPeriodo): Promise<{
  totalCentavos: number;
  fonte: FonteAds;
}> {
  const resumo = await getAdsResumo(periodo);
  return {
    totalCentavos: resumo.gastoCentavos,
    fonte: resumo.fonte,
  };
}

async function buscarVendas(periodo: IntervaloPeriodo): Promise<VendaDashboard[]> {
  const [vendas, vendasReembolsadas] = await Promise.all([
    buscarVendasBaseGestorSeller(periodo),
    buscarVendasReembolsadasGestorSeller(periodo),
  ]);
  const reembolsadas = new Set(vendasReembolsadas.map(chaveVendaDashboard));
  return vendas.filter((venda) => !reembolsadas.has(chaveVendaDashboard(venda)));
}

async function buscarVendasBaseGestorSeller(
  periodo: IntervaloPeriodo,
): Promise<VendaDashboard[]> {
  return db.vendaAmazon.findMany({
    where: whereVendaAmazonEspelhoGestorSeller({
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
      liquidoMarketplaceCentavos: true,
      impostoSimplesCentavos: true,
      custoUnitarioCentavos: true,
      dataVenda: true,
      statusFinanceiro: true,
    },
  });
}

async function buscarVendasReembolsadasGestorSeller(
  periodo: IntervaloPeriodo,
): Promise<VendaDashboard[]> {
  const reembolsos = await db.amazonReembolso.findMany({
    where: {
      dataReembolso: {
        gte: periodo.de,
        lte: periodo.ate,
      },
    },
    select: {
      amazonOrderId: true,
      sku: true,
    },
  });
  const chaves = [
    ...new Set(
      reembolsos.map(
        (reembolso) => `${reembolso.amazonOrderId}\u0000${reembolso.sku}`,
      ),
    ),
  ];
  if (chaves.length === 0) return [];

  return db.vendaAmazon.findMany({
    where: whereVendaAmazonEspelhoGestorSeller({
      dataVenda: { gte: periodo.de, lte: periodo.ate },
      OR: chaves.map((chave) => {
        const [amazonOrderId, sku] = chave.split("\u0000");
        return { amazonOrderId, sku };
      }),
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
      liquidoMarketplaceCentavos: true,
      impostoSimplesCentavos: true,
      custoUnitarioCentavos: true,
      dataVenda: true,
    },
  });
}

function chaveVendaDashboard(venda: Pick<VendaDashboard, "amazonOrderId" | "sku">) {
  return `${venda.amazonOrderId}\u0000${venda.sku}`;
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

function deriveOrigemTaxas(vendas: VendaDashboard[]): "real" | "estimado" | "misto" | "nenhuma" {
  if (vendas.length === 0) return "nenhuma";
  let real = 0;
  let estimado = 0;
  for (const v of vendas) {
    if (v.taxasEstimadas) estimado += 1;
    else if (v.taxasCentavos > 0) real += 1;
  }
  if (estimado === 0) return "real";
  if (real === 0) return "estimado";
  return "misto";
}

function formatBps(bps: number): string {
  const value = bps / 100;
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2)}%`;
}

function buildCategoriaTaxaEstimada(
  categoriaSlug: string | null | undefined,
  defaultBps: number,
): VendaDashboard["categoriaTaxaEstimada"] {
  const rule = findCommissionRule(categoriaSlug);
  if (rule) {
    return {
      slug: rule.slug,
      label: rule.label,
      regra: formatCommissionRule(rule),
    };
  }
  return {
    slug: null,
    label: "Default global",
    regra: formatBps(defaultBps),
  };
}

function resumirCategoriasTaxaEstimada(vendas: VendaDashboard[]) {
  const map = new Map<
    string,
    { slug: string | null; label: string; regra: string; vendas: number }
  >();

  for (const venda of vendas) {
    const categoria = venda.categoriaTaxaEstimada;
    if (!venda.taxasEstimadas || !categoria) continue;
    const key = categoria.slug ?? "__default__";
    const atual = map.get(key);
    if (atual) {
      atual.vendas += 1;
    } else {
      map.set(key, { ...categoria, vendas: 1 });
    }
  }

  return [...map.values()].sort(
    (a, b) => b.vendas - a.vendas || a.label.localeCompare(b.label),
  );
}

// Plug do fee-estimator: para vendas PENDENTE sem taxa real (Amazon nao
// settled ainda), aplica a estimativa Comissao+FBA. Quando settle, taxa real
// vem do FINANCES_SYNC e sobrescreve no banco — nao mexemos no banco aqui.
// Parcelamento NAO e estimado — vem do real quando aplicavel.
async function enriquecerComEstimativas(
  vendas: VendaDashboard[],
): Promise<VendaDashboard[]> {
  const candidatas = vendas.filter(
    (v) => v.taxasCentavos <= 0 && v.statusFinanceiro === "PENDENTE",
  );
  if (candidatas.length === 0) return vendas;

  const skusSet = new Set(candidatas.map((v) => v.sku));
  const produtos = await db.produto.findMany({
    where: { sku: { in: [...skusSet] } },
    select: { id: true, sku: true, amazonCategoriaFee: true },
  });
  const produtoBySku = new Map(
    produtos.map((p) => [p.sku, { id: p.id, categoriaSlug: p.amazonCategoriaFee }]),
  );

  const { loadFeeEstimatorConfig, estimarFeesVenda } = await import(
    "@/modules/produtos/fee-estimator"
  );
  const cfg = await loadFeeEstimatorConfig();

  return Promise.all(
    vendas.map(async (v) => {
      if (v.taxasCentavos > 0 || v.statusFinanceiro !== "PENDENTE") return v;
      const produto = produtoBySku.get(v.sku);
      if (!produto) return v;
      const bruto = v.valorBrutoCentavos ?? v.precoUnitarioCentavos * v.quantidade;
      const est = await estimarFeesVenda({
        produtoId: produto.id,
        valorBrutoCentavos: bruto,
        quantidade: v.quantidade,
        taxasReaisCentavos: 0,
        categoriaSlug: produto.categoriaSlug,
        cfg,
      });
      return {
        ...v,
        taxasCentavos: est.taxasCentavos,
        liquidoMarketplaceCentavos: bruto - est.taxasCentavos - v.fretesCentavos,
        taxasEstimadas: true,
        categoriaTaxaEstimada: buildCategoriaTaxaEstimada(
          produto.categoriaSlug,
          cfg.referralDefaultBps,
        ),
      };
    }),
  );
}

function agregarVendas(vendas: VendaDashboard[]) {
  const pedidos = new Set(vendas.map((venda) => venda.amazonOrderId));
  let faturamentoCentavos = 0;
  let taxasCentavos = 0;
  let fretesCentavos = 0;
  let liquidoMarketplaceCentavos = 0;
  let impostoSimplesCentavos = 0;
  let custoTotalCentavos = 0;
  let vendasSemCusto = 0;
  let unidades = 0;

  for (const venda of vendas) {
    faturamentoCentavos += faturamentoDaVenda(venda);
    taxasCentavos += venda.taxasCentavos;
    fretesCentavos += venda.fretesCentavos;
    liquidoMarketplaceCentavos +=
      venda.liquidoMarketplaceCentavos ??
      faturamentoDaVenda(venda) - venda.taxasCentavos - venda.fretesCentavos;
    impostoSimplesCentavos += venda.impostoSimplesCentavos ?? 0;
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
    liquidoMarketplaceCentavos,
    impostoSimplesCentavos,
    custoTotalCentavos,
    custoCompleto: vendasSemCusto === 0,
    vendasSemCusto,
    unidades,
    numeroVendas: pedidos.size,
  };
}

function calcularLucroBruto(agregado: ReturnType<typeof agregarVendas>) {
  if (!agregado.custoCompleto) return null;
  return (
    agregado.liquidoMarketplaceCentavos -
    agregado.custoTotalCentavos -
    agregado.impostoSimplesCentavos
  );
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
