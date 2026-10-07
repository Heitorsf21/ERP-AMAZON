// Visão "Todas" do Início: soma os resultados de CADA loja (já calculados pelo
// service do dashboard dentro do tenant dela). Puro, sem I/O.
//
// Nunca junta vendas cruas de lojas diferentes: imposto, ads e custos são
// configurados por loja. Somamos os totais e recalculamos os percentuais sobre
// as somas (nunca média de percentuais).

import type { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";
import { calcularMpaPosContasFixas } from "@/modules/contas-fixas/recorrencia";

export type KpisDashboard = Awaited<ReturnType<typeof dashboardEcommerceService.obterKpis>>;
export type TimelineDashboard = Awaited<
  ReturnType<typeof dashboardEcommerceService.obterTimeline>
>[number];
export type TopProdutoDashboard = Awaited<
  ReturnType<typeof dashboardEcommerceService.obterTopProdutos>
>[number];

export type LojaRef = { empresaId: string; nome: string };

export type PorLoja = LojaRef & {
  atual: boolean;
  faturamentoCentavos: number;
  /** Faturamento da loja ÷ faturamento somado. null quando o total é 0. */
  participacaoPercentual: number | null;
  lucroBrutoCentavos: number | null;
  margemPercentual: number | null;
  numeroVendas: number;
  mpaPercentual: number | null;
  vendasSemCusto: number;
};

export type KpisConsolidados = KpisDashboard & { porLoja: PorLoja[] };

function percentual(numerador: number | null, denominador: number | null): number | null {
  if (numerador == null || !denominador || denominador <= 0) return null;
  return (numerador / denominador) * 100;
}

function soma(valores: number[]): number {
  return valores.reduce((acc, v) => acc + v, 0);
}

/** Soma que vira null se qualquer parcela for null (custo incompleto em alguma loja). */
function somaOuNulo(valores: (number | null)[]): number | null {
  let total = 0;
  for (const v of valores) {
    if (v == null) return null;
    total += v;
  }
  return total;
}

function origemConsolidada(origens: KpisDashboard["origemTaxas"][]): KpisDashboard["origemTaxas"] {
  const presentes = new Set(origens.filter((o) => o !== "nenhuma"));
  if (presentes.size === 0) return "nenhuma";
  if (presentes.has("misto")) return "misto";
  if (presentes.size === 1) return [...presentes][0]!;
  return "misto";
}

function buyBoxPonderada(itens: KpisDashboard[]): number | null {
  const comValor = itens.filter((k) => k.trafficBuyBoxPercent != null);
  if (comValor.length === 0) return null;
  const sessoes = soma(comValor.map((k) => k.trafficSessions));
  if (sessoes > 0) {
    return soma(comValor.map((k) => k.trafficBuyBoxPercent! * k.trafficSessions)) / sessoes;
  }
  return soma(comValor.map((k) => k.trafficBuyBoxPercent!)) / comValor.length;
}

function categoriasConsolidadas(
  itens: KpisDashboard[],
): KpisDashboard["categoriasTaxaEstimada"] {
  const map = new Map<string, KpisDashboard["categoriasTaxaEstimada"][number]>();
  for (const k of itens) {
    for (const c of k.categoriasTaxaEstimada) {
      const chave = c.slug ?? "__default__";
      const atual = map.get(chave);
      if (atual) atual.vendas += c.vendas;
      else map.set(chave, { ...c });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.vendas - a.vendas || a.label.localeCompare(b.label),
  );
}

/**
 * Soma os KPIs das lojas (na ordem recebida) e devolve também o bloco
 * "Por loja". Imposto Simples (alíquota/ativo) é o da loja aberta.
 */
export function consolidarKpis(
  itens: { loja: LojaRef; kpis: KpisDashboard }[],
  atualEmpresaId: string,
): KpisConsolidados {
  const ks = itens.map((i) => i.kpis);
  const primeiro = ks[0];
  if (!primeiro) throw new Error("consolidarKpis: nenhuma loja");
  const daAtual = itens.find((i) => i.loja.empresaId === atualEmpresaId)?.kpis ?? primeiro;

  const faturamentoCentavos = soma(ks.map((k) => k.faturamentoCentavos));
  const numeroVendas = soma(ks.map((k) => k.numeroVendas));
  const lucroBrutoCentavos = somaOuNulo(ks.map((k) => k.lucroBrutoCentavos));
  const lucroPosAdsCentavos = somaOuNulo(ks.map((k) => k.lucroPosAdsCentavos));
  const custoTotalCentavos = somaOuNulo(ks.map((k) => k.custoTotalCentavos));
  const valorAdsCentavos = soma(ks.map((k) => k.valorAdsCentavos));
  const contasFixasCentavos = soma(ks.map((k) => k.contasFixasCentavos));
  const trafficSessions = soma(ks.map((k) => k.trafficSessions));
  const trafficUnitsOrdered = soma(ks.map((k) => k.trafficUnitsOrdered));
  const maiorGastoAds = [...ks].sort((a, b) => b.valorAdsCentavos - a.valorAdsCentavos)[0]!;
  const fontesIguais = ks.every((k) => k.valorAdsFonte === primeiro.valorAdsFonte);

  return {
    periodo: primeiro.periodo,
    faturamentoCentavos,
    freteCentavos: soma(ks.map((k) => k.freteCentavos)),
    faturamentoComFreteCentavos: soma(ks.map((k) => k.faturamentoComFreteCentavos)),
    faturamentoReembolsadoCentavos: soma(ks.map((k) => k.faturamentoReembolsadoCentavos)),
    faturamentoComReembolsadosCentavos: soma(ks.map((k) => k.faturamentoComReembolsadosCentavos)),
    liquidoMarketplaceCentavos: soma(ks.map((k) => k.liquidoMarketplaceCentavos)),
    impostoSimplesCentavos: soma(ks.map((k) => k.impostoSimplesCentavos)),
    impostoSimplesAliquotaBps: daAtual.impostoSimplesAliquotaBps,
    impostoSimplesAtivo: daAtual.impostoSimplesAtivo,
    lucroBrutoCentavos,
    margemPercentual: percentual(lucroBrutoCentavos, faturamentoCentavos),
    numeroVendas,
    unidades: soma(ks.map((k) => k.unidades)),
    ticketMedioCentavos: numeroVendas > 0 ? Math.round(faturamentoCentavos / numeroVendas) : 0,
    roiPercentual: percentual(lucroBrutoCentavos, custoTotalCentavos),
    valorAdsCentavos,
    tacosPercentual: percentual(valorAdsCentavos, faturamentoCentavos),
    lucroPosAdsCentavos,
    mpaPercentual: percentual(lucroPosAdsCentavos, faturamentoCentavos),
    contasFixasCentavos,
    mpaPosContasFixasPercentual: calcularMpaPosContasFixas({
      lucroPosAdsCentavos,
      contasFixasCentavos,
      faturamentoCentavos,
    }),
    roiPosAdsPercentual: percentual(lucroPosAdsCentavos, custoTotalCentavos),
    trafficSessions,
    trafficPageViews: soma(ks.map((k) => k.trafficPageViews)),
    trafficUnitsOrdered,
    trafficRevenueOrderedCentavos: soma(ks.map((k) => k.trafficRevenueOrderedCentavos)),
    trafficConversionPercent: percentual(trafficUnitsOrdered, trafficSessions),
    trafficBuyBoxPercent: buyBoxPonderada(ks),
    valorAdsFonte: fontesIguais ? primeiro.valorAdsFonte : maiorGastoAds.valorAdsFonte,
    valorAdsParcial: ks.some((k) => k.valorAdsParcial),
    custoTotalCentavos,
    vendasSemCusto: soma(ks.map((k) => k.vendasSemCusto)),
    vendasComTaxaEstimada: soma(ks.map((k) => k.vendasComTaxaEstimada)),
    categoriasTaxaEstimada: categoriasConsolidadas(ks),
    origemTaxas: origemConsolidada(ks.map((k) => k.origemTaxas)),
    porLoja: itens.map(({ loja, kpis: k }) => ({
      empresaId: loja.empresaId,
      nome: loja.nome,
      atual: loja.empresaId === atualEmpresaId,
      faturamentoCentavos: k.faturamentoCentavos,
      participacaoPercentual: percentual(k.faturamentoCentavos, faturamentoCentavos),
      lucroBrutoCentavos: k.lucroBrutoCentavos,
      margemPercentual: k.margemPercentual,
      numeroVendas: k.numeroVendas,
      mpaPercentual: k.mpaPercentual,
      vendasSemCusto: k.vendasSemCusto,
    })),
  };
}

function deltaPercent(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function deltaPP(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null) return null;
  return atual - anterior;
}

/** Variação contra o período anterior: % para valores, p.p. para percentuais. */
export function calcularDeltasKpis(kpis: KpisDashboard, prev: KpisDashboard) {
  return {
    faturamento: deltaPercent(kpis.faturamentoCentavos, prev.faturamentoCentavos),
    frete: deltaPercent(kpis.freteCentavos, prev.freteCentavos),
    faturamentoComFrete: deltaPercent(
      kpis.faturamentoComFreteCentavos,
      prev.faturamentoComFreteCentavos,
    ),
    faturamentoReembolsado: deltaPercent(
      kpis.faturamentoReembolsadoCentavos,
      prev.faturamentoReembolsadoCentavos,
    ),
    faturamentoComReembolsados: deltaPercent(
      kpis.faturamentoComReembolsadosCentavos,
      prev.faturamentoComReembolsadosCentavos,
    ),
    liquidoMarketplace: deltaPercent(kpis.liquidoMarketplaceCentavos, prev.liquidoMarketplaceCentavos),
    lucroBruto: deltaPercent(kpis.lucroBrutoCentavos, prev.lucroBrutoCentavos),
    margem: deltaPP(kpis.margemPercentual, prev.margemPercentual),
    numeroVendas: deltaPercent(kpis.numeroVendas, prev.numeroVendas),
    unidades: deltaPercent(kpis.unidades, prev.unidades),
    ticketMedio: deltaPercent(kpis.ticketMedioCentavos, prev.ticketMedioCentavos),
    roi: deltaPP(kpis.roiPercentual, prev.roiPercentual),
    valorAds: deltaPercent(kpis.valorAdsCentavos, prev.valorAdsCentavos),
    tacos: deltaPP(kpis.tacosPercentual, prev.tacosPercentual),
    lucroPosAds: deltaPercent(kpis.lucroPosAdsCentavos, prev.lucroPosAdsCentavos),
    roiPosAds: deltaPP(kpis.roiPosAdsPercentual, prev.roiPosAdsPercentual),
  };
}

/** Soma dia a dia (as lojas recebem o mesmo período, então os dias coincidem). */
export function consolidarTimeline(listas: TimelineDashboard[][]): TimelineDashboard[] {
  const porDia = new Map<string, TimelineDashboard[]>();
  for (const lista of listas) {
    for (const dia of lista) {
      porDia.set(dia.data, [...(porDia.get(dia.data) ?? []), dia]);
    }
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, dias]) => ({
      data,
      faturamentoCentavos: soma(dias.map((d) => d.faturamentoCentavos)),
      liquidoMarketplaceCentavos: soma(dias.map((d) => d.liquidoMarketplaceCentavos)),
      impostoSimplesCentavos: soma(dias.map((d) => d.impostoSimplesCentavos)),
      lucroBrutoCentavos: somaOuNulo(dias.map((d) => d.lucroBrutoCentavos)),
      lucroPosAdsCentavos: somaOuNulo(dias.map((d) => d.lucroPosAdsCentavos)),
    }));
}

export type TopProdutoConsolidado = TopProdutoDashboard & {
  loja: LojaRef & { atual: boolean };
};

/**
 * Top N das lojas juntas. Basta o top N de cada loja: o top N global está
 * dentro da união deles. Chave (loja, sku) — SKUs de lojas diferentes nunca se
 * fundem. A foto local (/api/produtos/:id/imagem) só existe na loja aberta: nos
 * itens das outras ela cai na imagem da Amazon.
 */
export function consolidarTopProdutos(
  listas: { loja: LojaRef; produtos: TopProdutoDashboard[]; totalFaturamentoCentavos: number }[],
  limit: number,
  atualEmpresaId: string,
): TopProdutoConsolidado[] {
  const total = soma(listas.map((l) => l.totalFaturamentoCentavos));
  return listas
    .flatMap(({ loja, produtos }) => {
      const atual = loja.empresaId === atualEmpresaId;
      return produtos.map((p) => ({
        ...p,
        imagemUrl: atual ? p.imagemUrl : null,
        representatividadePercentual: percentual(p.faturadoCentavos, total),
        loja: { empresaId: loja.empresaId, nome: loja.nome, atual },
      }));
    })
    .sort((a, b) => b.faturadoCentavos - a.faturadoCentavos)
    .slice(0, limit);
}
