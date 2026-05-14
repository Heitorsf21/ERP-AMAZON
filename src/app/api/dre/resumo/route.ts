import { NextRequest } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";
import {
  valorBrutoDaVenda,
  valorLiquidoMarketplaceDaVenda,
} from "@/modules/vendas/valores";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

function inicioDia(ano: number, mes: number, dia: number): Date {
  return fromZonedTime(new Date(ano, mes, dia, 0, 0, 0), TZ);
}

function fimDia(ano: number, mes: number, dia: number): Date {
  return fromZonedTime(new Date(ano, mes, dia, 23, 59, 59, 999), TZ);
}

async function calcularDRE(de: Date, ate: Date) {
  const [
    contasReceber,
    movEntradas,
    contasPagas,
    vendasAmazon,
    reembolsosAmazonAgg,
    reimbursementsFbaAgg,
    returnsAmazonAgg,
    storageFeesAgg,
    saidasEstoque,
    adsCampanhasAgg,
    adsManualAgg,
    adsSyncAgg,
    ultimoSyncLog,
  ] = await Promise.all([
    db.contaReceber.findMany({
      where: { status: "RECEBIDA", dataRecebimento: { gte: de, lte: ate }, deletedAt: null },
      select: { valor: true },
    }),
    db.movimentacao.findMany({
      where: { tipo: "ENTRADA", origem: "MANUAL", dataCaixa: { gte: de, lte: ate }, deletedAt: null },
      select: { valor: true, categoria: { select: { nome: true } } },
    }),
    db.contaPagar.findMany({
      where: { status: "PAGA", pagoEm: { gte: de, lte: ate }, deletedAt: null },
      include: { categoria: true },
    }),
    // Vendas Amazon detalhadas (Sprint 4 — DRE expandido).
    db.vendaAmazon.findMany({
      where: whereVendaAmazonContabilizavelEstrito({
        dataVenda: { gte: de, lte: ate },
      }),
      select: {
        valorBrutoCentavos: true,
        precoUnitarioCentavos: true,
        quantidade: true,
        liquidoMarketplaceCentavos: true,
        taxasCentavos: true,
        fretesCentavos: true,
      },
    }),
    db.amazonReembolso.aggregate({
      where: { dataReembolso: { gte: de, lte: ate } },
      _sum: {
        valorReembolsadoCentavos: true,
        taxasReembolsadasCentavos: true,
      },
      _count: { _all: true },
    }),
    db.amazonReimbursement.aggregate({
      where: { approvalDate: { gte: de, lte: ate } },
      _sum: { amountTotalCentavos: true },
      _count: { _all: true },
    }),
    db.amazonReturn.aggregate({
      where: { returnDate: { gte: de, lte: ate } },
      _sum: { valorEstimadoCentavos: true, quantity: true },
      _count: { _all: true },
    }),
    db.amazonStorageFee.aggregate({
      where: { monthOfCharge: { gte: de, lte: ate } },
      _sum: { storageFeeCentavos: true },
      _count: { _all: true },
    }),
    // CPV: cada SAÍDA de estoque × custo unitário histórico.
    db.movimentacaoEstoque.findMany({
      where: { tipo: "SAIDA", dataMovimentacao: { gte: de, lte: ate } },
      select: { quantidade: true, custoUnitario: true },
    }),
    db.adsCampanha.aggregate({
      where: {
        OR: [
          { periodoFim: { gte: de, lte: ate } },
          { periodoInicio: { gte: de, lte: ate } },
        ],
      },
      _sum: { gastoCentavos: true, vendasAtribuidasCentavos: true },
    }),
    db.adsGastoManual.aggregate({
      where: { periodoFim: { gte: de, lte: ate } },
      _sum: { valorCentavos: true },
    }),
    db.amazonAdsMetricaDiaria.aggregate({
      where: { data: { gte: de, lte: ate } },
      _sum: { gastoCentavos: true, vendasCentavos: true },
      _count: { _all: true },
    }),
    db.amazonSyncLog.findFirst({
      where: { status: "SUCESSO" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, tipo: true },
    }),
  ]);

  const receitaAmazonBase = contasReceber.reduce((s, c) => s + c.valor, 0);
  const reimbursementsFba = reimbursementsFbaAgg._sum.amountTotalCentavos ?? 0;
  const returnsEstimados = returnsAmazonAgg._sum.valorEstimadoCentavos ?? 0;
  const storageFees = storageFeesAgg._sum.storageFeeCentavos ?? 0;
  const receitaAmazon = receitaAmazonBase + reimbursementsFba;
  const outrasReceitas = movEntradas.reduce((s, m) => s + m.valor, 0);
  const totalReceitas = receitaAmazon + outrasReceitas;

  const porCategoria: Record<string, number> = {};
  for (const cp of contasPagas) {
    const nome = cp.categoria?.nome ?? "Outros";
    porCategoria[nome] = (porCategoria[nome] ?? 0) + cp.valor;
  }

  const taxasPlataforma = porCategoria["Taxas de plataformas/pagamentos"] ?? 0;
  const fretes = porCategoria["Fretes e entregas"] ?? 0;
  const totalDeducoes = taxasPlataforma + fretes + returnsEstimados;
  const receitaLiquida = totalReceitas - totalDeducoes;

  const custoMercadoriasBase =
    porCategoria["Compra de mercadorias/produtos"] ?? 0;
  const custoMercadorias = custoMercadoriasBase + storageFees;
  const margemBruta = receitaLiquida - custoMercadorias;
  const percentualMargemBruta =
    receitaLiquida > 0 ? (margemBruta / receitaLiquida) * 100 : 0;

  const excluirDoBelowLine = new Set([
    "Compra de mercadorias/produtos",
    "Taxas de plataformas/pagamentos",
    "Fretes e entregas",
  ]);

  const despesaMarketing = porCategoria["Marketing"] ?? 0;

  const despesasOperacionais = Object.entries(porCategoria)
    .filter(([cat]) => !excluirDoBelowLine.has(cat))
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);

  const totalDespesas = despesasOperacionais.reduce((s, d) => s + d.valor, 0);
  const resultadoOperacional = margemBruta - totalDespesas;

  const roi =
    custoMercadorias > 0 ? (resultadoOperacional / custoMercadorias) * 100 : 0;
  const mpaValor = margemBruta - despesaMarketing;
  const mpaPercentual =
    totalReceitas > 0 ? (mpaValor / totalReceitas) * 100 : 0;

  // ── Bloco enriquecido (dados Amazon completos) ───────────────────
  const vendasAmazonBrutas = vendasAmazon.reduce(
    (s, v) => s + valorBrutoDaVenda(v),
    0,
  );
  const vendasAmazonLiquidas = vendasAmazon.reduce(
    (s, v) => s + valorLiquidoMarketplaceDaVenda(v),
    0,
  );
  const taxasAmazon = vendasAmazon.reduce((s, v) => s + v.taxasCentavos, 0);
  const fretesAmazon = vendasAmazon.reduce((s, v) => s + v.fretesCentavos, 0);
  const reembolsosValor = reembolsosAmazonAgg._sum.valorReembolsadoCentavos ?? 0;
  const reembolsosTaxas = reembolsosAmazonAgg._sum.taxasReembolsadasCentavos ?? 0;
  const cpvEstoqueCalculado = saidasEstoque.reduce(
    (s, m) => s + m.quantidade * (m.custoUnitario ?? 0),
    0,
  );
  const skusSemCusto = saidasEstoque.filter(
    (m) => m.custoUnitario === null || m.custoUnitario === 0,
  ).length;
  const adsCampanhasCentavos = adsCampanhasAgg._sum.gastoCentavos ?? 0;
  const adsManualCentavos = adsManualAgg._sum.valorCentavos ?? 0;
  const adsSyncGasto = adsSyncAgg._sum.gastoCentavos ?? 0;
  const adsSyncVendas = adsSyncAgg._sum.vendasCentavos ?? 0;
  const adsSyncAcos = adsSyncVendas > 0 ? adsSyncGasto / adsSyncVendas : null;
  // Quando ha sync da Amazon Ads API, ele eh fonte de verdade. AdsCampanha/manual
  // viram fallback para periodos sem sync.
  const adsTotal =
    adsSyncGasto > 0
      ? adsSyncGasto
      : adsCampanhasCentavos + adsManualCentavos;

  return {
    receitaAmazon,
    outrasReceitas,
    totalReceitas,
    taxasPlataforma,
    fretes,
    totalDeducoes,
    receitaLiquida,
    custoMercadorias,
    margemBruta,
    percentualMargemBruta,
    despesaMarketing,
    despesasOperacionais,
    totalDespesas,
    resultadoOperacional,
    roi,
    mpaValor,
    mpaPercentual,
    resultadoFinal: resultadoOperacional,
    quantidadeLiquidacoes: contasReceber.length,

    // Detalhamento Amazon (novos):
    amazon: {
      vendasBrutas: vendasAmazonBrutas,
      vendasLiquidas: vendasAmazonLiquidas,
      taxas: taxasAmazon,
      fretes: fretesAmazon,
      reembolsos: reembolsosValor,
      reembolsosTaxas: reembolsosTaxas,
      receitaLiquidacoes: receitaAmazonBase,
      reimbursementsFba,
      returnsEstimados,
      storageFees,
      quantidadeVendas: vendasAmazon.length,
      quantidadeReembolsos: reembolsosAmazonAgg._count._all ?? 0,
      quantidadeReimbursementsFba: reimbursementsFbaAgg._count._all ?? 0,
      quantidadeReturns: returnsAmazonAgg._count._all ?? 0,
      quantidadeStorageFees: storageFeesAgg._count._all ?? 0,
      unidadesReturns: returnsAmazonAgg._sum.quantity ?? 0,
    },
    cpv: {
      calculado: cpvEstoqueCalculado,
      contasPagas: custoMercadoriasBase,
      storageFees,
      skusSemCusto,
    },
    ads: {
      campanhas: adsCampanhasCentavos,
      manual: adsManualCentavos,
      sync: adsSyncGasto,
      syncVendas: adsSyncVendas,
      syncAcos: adsSyncAcos,
      total: adsTotal,
      origem: adsSyncGasto > 0 ? "SYNC" : "MANUAL",
    },
    ultimaAtualizacao: ultimoSyncLog?.createdAt ?? null,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const modo = searchParams.get("modo"); // "mensal" para visão anual

  if (modo === "mensal") {
    const ano = parseInt(searchParams.get("ano") ?? String(new Date().getFullYear()));
    const meses = [];
    for (let m = 0; m < 12; m++) {
      const de = inicioDia(ano, m, 1);
      const ate = fimDia(ano, m + 1, 0);
      // Não processar meses no futuro
      if (de > new Date()) {
        meses.push({
          mes: m + 1,
          nome: de.toLocaleDateString("pt-BR", { month: "short" }),
          de: de.toISOString().split("T")[0],
          ate: ate.toISOString().split("T")[0],
          vazio: true,
        });
        continue;
      }
      const dre = await calcularDRE(de, ate);
      meses.push({
        mes: m + 1,
        nome: de.toLocaleDateString("pt-BR", { month: "short" }),
        de: de.toISOString().split("T")[0],
        ate: ate.toISOString().split("T")[0],
        vazio: false,
        ...dre,
      });
    }
    return ok({ ano, meses });
  }

  // Modo padrão — período personalizado
  const hoje = new Date();
  const inicioMes = inicioDia(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = fimDia(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  const deStr = searchParams.get("de");
  const ateStr = searchParams.get("ate");

  const de = deStr ? fromZonedTime(new Date(deStr + "T00:00:00"), TZ) : inicioMes;
  const ate = ateStr ? fromZonedTime(new Date(ateStr + "T23:59:59"), TZ) : fimMes;

  const dre = await calcularDRE(de, ate);

  return ok({
    periodo: {
      de: de.toISOString().split("T")[0],
      ate: ate.toISOString().split("T")[0],
    },
    ...dre,
  });
}
