/**
 * Orquestrador do Breakdown Financeiro inline da página de Vendas Amazon.
 *
 * Por que existe:
 *   A tela de Vendas (cards expansíveis) exige um detalhamento desagregado
 *   por pedido (Comissão · Taxa FBA · Taxa Parcelamento · Frete recebido/pago
 *   · Imposto · Custo · Lucro). O schema atual só guarda agregados em
 *   `VendaAmazon.taxasCentavos` e `fretesCentavos`. Este módulo monta o
 *   breakdown em runtime sem persistir nada novo:
 *
 *   - Para vendas **settled** (com `AmazonFinanceTransaction` materializada):
 *     parseia o payload via [breakdown-parser](./breakdown-parser.ts) para
 *     extrair sub-fees nativas (Commission, FBA, AmazonForAllFee, Closing).
 *   - Para vendas **pending** (sem transação Finance): usa
 *     [`calcularFeesLocal`](../produtos/fee-estimator.ts) que já produz
 *     `{ comissaoCentavos, fbaCentavos, closingFeeCentavos }`. Parcelamento
 *     fica 0 (não é estimável). Frete recebido/pago ficam 0 (sem payload).
 *   - Para vendas **canceladas sem movimentação**: breakdown zerado.
 *
 * Performance:
 *   Independentemente da quantidade de vendas, faz no máximo 4 queries
 *   batch (Produto, ProdutoCustoHistorico, AmazonFeeEstimate,
 *   AmazonFinanceTransaction) + a config cacheada. Substitui o N+1
 *   anterior de [taxas-estimadas](./taxas-estimadas.ts).
 *
 * Restrições (regras sagradas do CLAUDE.md):
 *   - NUNCA escrever em `VendaAmazon.taxasCentavos`, `fretesCentavos` ou
 *     `liquidoMarketplaceCentavos`. Tudo aqui é leitura.
 *   - NUNCA chamar SP-API. Apenas DB.
 *   - O total bruto vem SEMPRE de
 *     [`valorBrutoDaVenda`](./valores.ts) — nunca recalcular do produto.
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { formatarDiaPeriodo } from "@/lib/periodo";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import {
  calcularFeesLocal,
  loadFeeEstimatorConfig,
  type FeeEstimateConfig,
} from "@/modules/produtos/fee-estimator";
import {
  chaveResolucao,
  resolverCustoUnitarioEmLote,
} from "@/modules/produtos/custo-historico";
import {
  agregarBreakdownDeTransacoes,
  type ParsedFinanceBreakdown,
} from "./breakdown-parser";
import {
  STATUS_PEDIDO_CANCELADO,
  normalizarStatus,
} from "./filtros";
import {
  calcularImpostoSimplesCentavos,
  normalizarCentavos,
  normalizarQuantidadeVenda,
  valorBrutoDaVenda,
  type VendaAmazonValoresInput,
} from "./valores";

/** Origem do breakdown — define como a UI representa cada linha. */
export type BreakdownOrigem = "settled" | "estimated" | "no_data";

/**
 * Detalhamento financeiro completo de uma linha de venda. Todos os valores
 * em centavos e sempre POSITIVOS — o sinal (receita ou custo) está
 * codificado na semântica do nome do campo.
 */
export type CustoEventualLista = {
  id: string;
  descricao: string;
  valorCentavos: number;
  criadoEm: string;
};

export type BreakdownVenda = {
  totalItensCentavos: number;
  freteRecebidoCentavos: number;
  fretePagoCentavos: number;
  comissaoCentavos: number;
  taxaFbaCentavos: number;
  taxaParcelamentoCentavos: number;
  closingFeeCentavos: number;
  promoRebatesCentavos: number;
  impostoCentavos: number;
  custoProdutoCentavos: number;
  custoExtraCentavos: number;
  custosEventuais: CustoEventualLista[];
  lucroCentavos: number;
  margemBps: number;
  /**
   * Custo de Ads atribuído à venda específica via rateio sobre os "attributed
   * sales" do SKU no mesmo dia BRT em `AmazonAdsMetricaDiaria`. Zero quando
   * não há sync de Ads cobrindo o dia/SKU. Não considera ads gerais sem SKU.
   */
  custoAdsCentavos: number;
  /** lucroCentavos − custoAdsCentavos. */
  lucroPosAdsCentavos: number;
  /** Margem pós-Ads (lucroPosAds / totalItens) em basis points (10000 = 100%). */
  mpaBps: number;
  origem: BreakdownOrigem;
  categoriaTaxaSlug: string | null;
  categoriaTaxaLabel: string | null;
};

/**
 * Subset de campos de `VendaAmazon` consumidos pelo orquestrador. Replica
 * apenas o necessário — assim `montarBreakdownVendas` pode ser testado sem
 * depender de um row Prisma completo.
 */
export type VendaParaBreakdown = VendaAmazonValoresInput & {
  id: string;
  amazonOrderId: string;
  orderItemId: string | null;
  sku: string;
  asin?: string | null;
  dataVenda: Date;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
};

/** Imagem + categoria do produto, propagados para a UI sem queries extra. */
export type EnriquecimentoProdutoSku = {
  produtoId: string | null;
  amazonAsin: string | null;
  amazonImagemUrl: string | null;
  imagemUrl: string | null;
  amazonCategoriaFee: string | null;
};

export type ResultadoBreakdown = {
  breakdownPorVenda: Map<string, BreakdownVenda>;
  produtoPorSku: Map<string, EnriquecimentoProdutoSku>;
};

const STATUS_PEDIDO_CANCELADO_SET = new Set(
  STATUS_PEDIDO_CANCELADO.map(normalizarStatus),
);

/**
 * Monta o breakdown financeiro de uma lista de vendas em ≤ 4 queries
 * batch (independente do tamanho da lista).
 */
export async function montarBreakdownVendas(
  vendas: VendaParaBreakdown[],
): Promise<ResultadoBreakdown> {
  const breakdownPorVenda = new Map<string, BreakdownVenda>();
  const produtoPorSku = new Map<string, EnriquecimentoProdutoSku>();

  if (vendas.length === 0) {
    return { breakdownPorVenda, produtoPorSku };
  }

  const inicio = Date.now();

  // ── Pre-loads em paralelo ───────────────────────────────────────────────
  const skusDistintos = [...new Set(vendas.map((v) => v.sku))];
  const orderIdsDistintos = [
    ...new Set(vendas.map((v) => v.amazonOrderId).filter(Boolean)),
  ];
  const vendaIds = vendas.map((v) => v.id);

  // Limites do range de dias BRT cobertos pelas vendas — usado para a query
  // de AmazonAdsMetricaDiaria (rateio de ads por venda específica).
  const datasVendas = vendas.map((v) => v.dataVenda.getTime());
  const adsRangeGte = new Date(
    `${formatarDiaPeriodo(new Date(Math.min(...datasVendas)))}T00:00:00.000Z`,
  );
  const adsRangeLte = new Date(
    `${formatarDiaPeriodo(new Date(Math.max(...datasVendas)))}T23:59:59.999Z`,
  );

  const [
    produtos,
    transactions,
    custosEventuaisRows,
    adsMetricasDiarias,
    feeCfg,
    impostoCfg,
  ] = await Promise.all([
    db.produto.findMany({
      where: { sku: { in: skusDistintos } },
      select: {
        id: true,
        sku: true,
        asin: true,
        amazonImagemUrl: true,
        imagemUrl: true,
        amazonCategoriaFee: true,
        custoUnitario: true,
      },
    }),
    orderIdsDistintos.length > 0
      ? db.amazonFinanceTransaction.findMany({
          where: { amazonOrderId: { in: orderIdsDistintos } },
          select: {
            amazonOrderId: true,
            transactionType: true,
            payload: true,
          },
        })
      : Promise.resolve([]),
    db.vendaCustoEventual.findMany({
      where: { vendaAmazonId: { in: vendaIds } },
      orderBy: { criadoEm: "desc" },
      select: {
        id: true,
        vendaAmazonId: true,
        descricao: true,
        valorCentavos: true,
        criadoEm: true,
      },
    }),
    db.amazonAdsMetricaDiaria.findMany({
      where: {
        sku: { in: skusDistintos },
        data: { gte: adsRangeGte, lte: adsRangeLte },
      },
      select: {
        data: true,
        sku: true,
        gastoCentavos: true,
        vendasCentavos: true,
      },
    }),
    loadFeeEstimatorConfig(),
    getConfigImpostoSimples(),
  ]);

  for (const p of produtos) {
    produtoPorSku.set(p.sku, {
      produtoId: p.id,
      amazonAsin: p.asin,
      amazonImagemUrl: p.amazonImagemUrl,
      imagemUrl: p.imagemUrl,
      amazonCategoriaFee: p.amazonCategoriaFee,
    });
  }

  // Map<amazonOrderId, transactions[]>
  const txByOrderId = new Map<
    string,
    Array<{ payload: unknown; transactionType: string | null }>
  >();
  for (const tx of transactions) {
    if (!tx.amazonOrderId) continue;
    const arr = txByOrderId.get(tx.amazonOrderId) ?? [];
    arr.push({ payload: tx.payload, transactionType: tx.transactionType });
    txByOrderId.set(tx.amazonOrderId, arr);
  }

  // Custos — uma única query batch resolvida pelo helper especializado.
  const paresParaCusto = vendas
    .map((venda) => ({
      produtoId: produtoPorSku.get(venda.sku)?.produtoId ?? null,
      dataVenda: venda.dataVenda,
    }))
    .filter((p): p is { produtoId: string; dataVenda: Date } => p.produtoId != null);

  const fallbacksCusto = produtos.map((p) => ({
    produtoId: p.id,
    custoUnitario: p.custoUnitario && p.custoUnitario > 0 ? p.custoUnitario : null,
  }));

  const custoMap =
    paresParaCusto.length > 0
      ? await resolverCustoUnitarioEmLote(paresParaCusto, fallbacksCusto)
      : new Map<string, number>();

  // Map<vendaAmazonId, CustoEventualLista[]>
  const custosEventuaisPorVenda = new Map<string, CustoEventualLista[]>();
  for (const c of custosEventuaisRows) {
    const arr = custosEventuaisPorVenda.get(c.vendaAmazonId) ?? [];
    arr.push({
      id: c.id,
      descricao: c.descricao,
      valorCentavos: c.valorCentavos,
      criadoEm: c.criadoEm.toISOString(),
    });
    custosEventuaisPorVenda.set(c.vendaAmazonId, arr);
  }

  // Map<"sku|yyyy-MM-dd", { gasto, vendasAtribuidas }> — soma todas as
  // campanhas/adGroups daquele SKU no mesmo dia BRT.
  const adsPorSkuDia = new Map<
    string,
    { gastoCentavos: number; vendasAtribuidasCentavos: number }
  >();
  for (const row of adsMetricasDiarias) {
    if (!row.sku) continue;
    const chave = `${row.sku}|${formatarDiaPeriodo(row.data)}`;
    const atual = adsPorSkuDia.get(chave);
    if (atual) {
      atual.gastoCentavos += row.gastoCentavos;
      atual.vendasAtribuidasCentavos += row.vendasCentavos;
    } else {
      adsPorSkuDia.set(chave, {
        gastoCentavos: row.gastoCentavos,
        vendasAtribuidasCentavos: row.vendasCentavos,
      });
    }
  }

  // Soma de faturamento por (sku, dia) — usado como fallback de rateio quando
  // o sync de Ads existe mas a Amazon atribuiu R$0 de vendas naquele dia.
  const faturamentoPorSkuDia = new Map<string, number>();
  for (const venda of vendas) {
    const chave = `${venda.sku}|${formatarDiaPeriodo(venda.dataVenda)}`;
    faturamentoPorSkuDia.set(
      chave,
      (faturamentoPorSkuDia.get(chave) ?? 0) + valorBrutoDaVenda(venda),
    );
  }

  // ── Montagem por venda ──────────────────────────────────────────────────
  for (const venda of vendas) {
    const breakdown = montarUma(venda, {
      produtoPorSku,
      txByOrderId,
      custoMap,
      custosEventuaisPorVenda,
      adsPorSkuDia,
      faturamentoPorSkuDia,
      feeCfg,
      impostoCfg,
    });
    breakdownPorVenda.set(venda.id, breakdown);
  }

  logger.info(
    {
      durationMs: Date.now() - inicio,
      vendas: vendas.length,
      ordersUnicos: orderIdsDistintos.length,
      skusUnicos: skusDistintos.length,
      transacoesCarregadas: transactions.length,
      custosEventuais: custosEventuaisRows.length,
      adsMetricasDiarias: adsMetricasDiarias.length,
    },
    "vendas breakdown built",
  );

  return { breakdownPorVenda, produtoPorSku };
}

type ContextoMontagem = {
  produtoPorSku: Map<string, EnriquecimentoProdutoSku>;
  txByOrderId: Map<
    string,
    Array<{ payload: unknown; transactionType: string | null }>
  >;
  custoMap: Map<string, number>;
  custosEventuaisPorVenda: Map<string, CustoEventualLista[]>;
  adsPorSkuDia: Map<
    string,
    { gastoCentavos: number; vendasAtribuidasCentavos: number }
  >;
  faturamentoPorSkuDia: Map<string, number>;
  feeCfg: FeeEstimateConfig;
  impostoCfg: { aliquotaBps: number; ativo: boolean };
};

function montarUma(
  venda: VendaParaBreakdown,
  ctx: ContextoMontagem,
): BreakdownVenda {
  const totalItensCentavos = valorBrutoDaVenda(venda);
  const quantidade = normalizarQuantidadeVenda(venda.quantidade);
  const taxasRealCentavos = normalizarCentavos(venda.taxasCentavos);
  const freteAgregadoCentavos = normalizarCentavos(venda.fretesCentavos);
  const produto = ctx.produtoPorSku.get(venda.sku) ?? null;

  const isCancelado = STATUS_PEDIDO_CANCELADO_SET.has(
    normalizarStatus(venda.statusPedido ?? ""),
  );

  const transactions = ctx.txByOrderId.get(venda.amazonOrderId) ?? [];
  const parsed = transactions.length > 0
    ? agregarBreakdownDeTransacoes(transactions, venda.sku, venda.orderItemId)
    : null;

  let origem: BreakdownOrigem;
  let comissaoCentavos = 0;
  let taxaFbaCentavos = 0;
  let taxaParcelamentoCentavos = 0;
  let closingFeeCentavos = 0;
  let promoRebatesCentavos = 0;
  let freteRecebidoCentavos = 0;
  let fretePagoCentavos = 0;
  let categoriaSlug: string | null = null;
  let categoriaLabel: string | null = null;

  if (parsed && parsed.encontrado) {
    origem = "settled";
    comissaoCentavos = parsed.comissaoCentavos;
    taxaFbaCentavos = parsed.taxaFbaCentavos;
    taxaParcelamentoCentavos = parsed.taxaParcelamentoCentavos;
    closingFeeCentavos = parsed.closingFeeCentavos;
    promoRebatesCentavos = parsed.promoRebatesCentavos;
    freteRecebidoCentavos = parsed.freteRecebidoCentavos;
    fretePagoCentavos = parsed.fretePagoCentavos;
  } else if (isCancelado && taxasRealCentavos <= 0 && freteAgregadoCentavos <= 0) {
    origem = "no_data";
  } else if (taxasRealCentavos > 0) {
    // Venda settled mas sem payload Finance disponível — exibe o agregado
    // como comissão (não perde o valor) e zera os demais sub-componentes.
    origem = "settled";
    comissaoCentavos = taxasRealCentavos;
    fretePagoCentavos = freteAgregadoCentavos;
  } else if (totalItensCentavos > 0 && produto?.produtoId != null) {
    origem = "estimated";
    // calcularFeesLocal ja retorna fbaCentavos e closingFeeCentavos agregados
    // pela quantidade (FBA avaliado contra o PRECO UNITARIO de cada item,
    // conforme regra Amazon Brasil 2026: R$5/un se unit <= R$99.99).
    const est = calcularFeesLocal(
      totalItensCentavos,
      quantidade,
      ctx.feeCfg,
      { categoriaSlug: produto.amazonCategoriaFee },
    );
    comissaoCentavos = est.comissaoCentavos;
    taxaFbaCentavos = est.fbaCentavos;
    closingFeeCentavos = est.closingFeeCentavos;
    taxaParcelamentoCentavos = 0; // Não é estimável
    categoriaSlug = produto.amazonCategoriaFee;
    categoriaLabel = est.categoriaLabel ?? null;
  } else {
    origem = "no_data";
  }

  // Custo via Map pré-resolvido (zero query extra)
  const custoProdutoCentavos =
    produto?.produtoId != null
      ? (ctx.custoMap.get(chaveResolucao(produto.produtoId, venda.dataVenda)) ?? 0) *
        quantidade
      : 0;

  // Imposto Simples (puro, sem I/O)
  const impostoCentavos = calcularImpostoSimplesCentavos({
    valorBrutoCentavos: totalItensCentavos,
    aliquotaBps: ctx.impostoCfg.aliquotaBps,
    ativo: ctx.impostoCfg.ativo,
    statusPedido: venda.statusPedido ?? null,
    statusFinanceiro: venda.statusFinanceiro ?? null,
  });

  // Custos eventuais — soma dos valores lançados manualmente (ad-hoc).
  const custosEventuais = ctx.custosEventuaisPorVenda.get(venda.id) ?? [];
  const custoExtraCentavos = custosEventuais.reduce(
    (sum, c) => sum + c.valorCentavos,
    0,
  );

  const lucroCentavos = origem === "no_data"
    ? 0
    : totalItensCentavos
      + freteRecebidoCentavos
      - fretePagoCentavos
      - comissaoCentavos
      - taxaFbaCentavos
      - taxaParcelamentoCentavos
      - closingFeeCentavos
      - promoRebatesCentavos
      - impostoCentavos
      - custoProdutoCentavos
      - custoExtraCentavos;

  const margemBps =
    totalItensCentavos > 0
      ? Math.round((lucroCentavos / totalItensCentavos) * 10000)
      : 0;

  // Ads atribuído à venda específica (rateio sobre attributed sales 7d do
  // SKU no mesmo dia BRT). Só vale quando há sync de Ads — não estima.
  const custoAdsCentavos =
    origem === "no_data"
      ? 0
      : ratearAdsParaVenda(venda, totalItensCentavos, ctx);

  const lucroPosAdsCentavos = lucroCentavos - custoAdsCentavos;
  const mpaBps =
    totalItensCentavos > 0
      ? Math.round((lucroPosAdsCentavos / totalItensCentavos) * 10000)
      : 0;

  return {
    totalItensCentavos: origem === "no_data" ? 0 : totalItensCentavos,
    freteRecebidoCentavos,
    fretePagoCentavos,
    comissaoCentavos,
    taxaFbaCentavos,
    taxaParcelamentoCentavos,
    closingFeeCentavos,
    promoRebatesCentavos,
    impostoCentavos: origem === "no_data" ? 0 : impostoCentavos,
    custoProdutoCentavos: origem === "no_data" ? 0 : custoProdutoCentavos,
    custoExtraCentavos,
    custosEventuais,
    lucroCentavos,
    margemBps,
    custoAdsCentavos,
    lucroPosAdsCentavos,
    mpaBps,
    origem,
    categoriaTaxaSlug: categoriaSlug,
    categoriaTaxaLabel: categoriaLabel,
  };
}

/**
 * Rateia o gasto de Ads do SKU/dia para esta venda específica.
 *
 * Estratégia: usa o `vendasCentavos` (attributed sales 7d da Amazon Ads) do
 * mesmo SKU+dia BRT como denominador — é a melhor proxy disponível para
 * "quanto desta venda veio de tráfego pago". Fallback: rateio proporcional
 * ao faturamento das vendas do SKU naquele dia (quando a Amazon atribuiu R$0
 * mas houve gasto registrado).
 *
 * Retorna sempre cap superior ao gasto total do SKU/dia para evitar que
 * múltiplas vendas pequenas com vendasAtribuidas inflado estourem o gasto.
 */
function ratearAdsParaVenda(
  venda: VendaParaBreakdown,
  totalItensCentavos: number,
  ctx: ContextoMontagem,
): number {
  if (totalItensCentavos <= 0) return 0;
  const chave = `${venda.sku}|${formatarDiaPeriodo(venda.dataVenda)}`;
  const ads = ctx.adsPorSkuDia.get(chave);
  if (!ads || ads.gastoCentavos <= 0) return 0;

  const denominador =
    ads.vendasAtribuidasCentavos > 0
      ? ads.vendasAtribuidasCentavos
      : (ctx.faturamentoPorSkuDia.get(chave) ?? 0);
  if (denominador <= 0) return 0;

  const rateio = Math.round(
    ads.gastoCentavos * (totalItensCentavos / denominador),
  );
  // Cap: a soma do rateio de todas as vendas do SKU/dia nunca deve exceder
  // o gasto real — limitar individualmente é defesa em profundidade.
  return Math.min(rateio, ads.gastoCentavos);
}

/** Helper exportado também para os testes — useful para previews tipo SSR. */
export function breakdownVazio(): BreakdownVenda {
  return {
    totalItensCentavos: 0,
    freteRecebidoCentavos: 0,
    fretePagoCentavos: 0,
    comissaoCentavos: 0,
    taxaFbaCentavos: 0,
    taxaParcelamentoCentavos: 0,
    closingFeeCentavos: 0,
    promoRebatesCentavos: 0,
    impostoCentavos: 0,
    custoProdutoCentavos: 0,
    custoExtraCentavos: 0,
    custosEventuais: [],
    lucroCentavos: 0,
    margemBps: 0,
    custoAdsCentavos: 0,
    lucroPosAdsCentavos: 0,
    mpaBps: 0,
    origem: "no_data",
    categoriaTaxaSlug: null,
    categoriaTaxaLabel: null,
  };
}

/** Re-export para callers da API. */
export type { ParsedFinanceBreakdown };
