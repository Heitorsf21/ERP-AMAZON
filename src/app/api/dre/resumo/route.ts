import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok } from "@/lib/api";

export const dynamic = "force-dynamic";

async function calcularDRE(de: Date, ate: Date) {
  const [
    contasReceber,
    movEntradas,
    contasPagas,
    vendasAmazonAgg,
    reembolsosAmazonAgg,
    saidasEstoque,
    adsCampanhasAgg,
    adsManualAgg,
  ] = await Promise.all([
    db.contaReceber.findMany({
      where: { status: "RECEBIDA", dataRecebimento: { gte: de, lte: ate } },
      select: { valor: true },
    }),
    db.movimentacao.findMany({
      where: { tipo: "ENTRADA", origem: "MANUAL", dataCaixa: { gte: de, lte: ate } },
      select: { valor: true, categoria: { select: { nome: true } } },
    }),
    db.contaPagar.findMany({
      where: { status: "PAGA", pagoEm: { gte: de, lte: ate } },
      include: { categoria: true },
    }),
    // Vendas Amazon detalhadas (Sprint 4 — DRE expandido).
    db.vendaAmazon.aggregate({
      where: { dataVenda: { gte: de, lte: ate } },
      _sum: {
        valorBrutoCentavos: true,
        liquidoMarketplaceCentavos: true,
        taxasCentavos: true,
        fretesCentavos: true,
      },
      _count: { _all: true },
    }),
    db.amazonReembolso.aggregate({
      where: { dataReembolso: { gte: de, lte: ate } },
      _sum: {
        valorReembolsadoCentavos: true,
        taxasReembolsadasCentavos: true,
      },
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
  ]);

  const receitaAmazon = contasReceber.reduce((s, c) => s + c.valor, 0);
  const outrasReceitas = movEntradas.reduce((s, m) => s + m.valor, 0);
  const totalReceitas = receitaAmazon + outrasReceitas;

  const porCategoria: Record<string, number> = {};
  for (const cp of contasPagas) {
    const nome = cp.categoria?.nome ?? "Outros";
    porCategoria[nome] = (porCategoria[nome] ?? 0) + cp.valor;
  }

  const taxasPlataforma = porCategoria["Taxas de plataformas/pagamentos"] ?? 0;
  const fretes = porCategoria["Fretes e entregas"] ?? 0;
  const totalDeducoes = taxasPlataforma + fretes;
  const receitaLiquida = totalReceitas - totalDeducoes;

  const custoMercadorias = porCategoria["Compra de mercadorias/produtos"] ?? 0;
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
  const vendasAmazonBrutas = vendasAmazonAgg._sum.valorBrutoCentavos ?? 0;
  const vendasAmazonLiquidas = vendasAmazonAgg._sum.liquidoMarketplaceCentavos ?? 0;
  const taxasAmazon = vendasAmazonAgg._sum.taxasCentavos ?? 0;
  const fretesAmazon = vendasAmazonAgg._sum.fretesCentavos ?? 0;
  const reembolsosValor = reembolsosAmazonAgg._sum.valorReembolsadoCentavos ?? 0;
  const reembolsosTaxas = reembolsosAmazonAgg._sum.taxasReembolsadasCentavos ?? 0;
  const cpvEstoqueCalculado = saidasEstoque.reduce(
    (s, m) => s + m.quantidade * (m.custoUnitario ?? 0),
    0,
  );
  const adsCampanhasCentavos = adsCampanhasAgg._sum.gastoCentavos ?? 0;
  const adsManualCentavos = adsManualAgg._sum.valorCentavos ?? 0;
  const adsTotal = adsCampanhasCentavos + adsManualCentavos;

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
      quantidadeVendas: vendasAmazonAgg._count._all ?? 0,
      quantidadeReembolsos: reembolsosAmazonAgg._count._all ?? 0,
    },
    cpv: {
      calculado: cpvEstoqueCalculado,
      contasPagas: custoMercadorias,
    },
    ads: {
      campanhas: adsCampanhasCentavos,
      manual: adsManualCentavos,
      total: adsTotal,
    },
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const modo = searchParams.get("modo"); // "mensal" para visão anual

  if (modo === "mensal") {
    const ano = parseInt(searchParams.get("ano") ?? String(new Date().getFullYear()));
    const meses = [];
    for (let m = 0; m < 12; m++) {
      const de = new Date(ano, m, 1, 0, 0, 0);
      const ate = new Date(ano, m + 1, 0, 23, 59, 59);
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
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

  const deStr = searchParams.get("de");
  const ateStr = searchParams.get("ate");

  const de = deStr ? new Date(deStr + "T00:00:00") : inicioMes;
  const ate = ateStr ? new Date(ateStr + "T23:59:59") : fimMes;

  const dre = await calcularDRE(de, ate);

  return ok({
    periodo: {
      de: de.toISOString().split("T")[0],
      ate: ate.toISOString().split("T")[0],
    },
    ...dre,
  });
}
