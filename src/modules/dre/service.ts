/**
 * Serviço de DRE (Demonstração do Resultado do Exercício).
 *
 * Dois regimes:
 *   - COMPETÊNCIA (`calcularDreCompetencia`): resultado por DATA DA VENDA,
 *     alimentado automaticamente pelos dados que o sistema já sincroniza da
 *     Amazon (vendas, taxas reais ou estimadas, frete, imposto, custo do que
 *     foi vendido, Ads) + despesas operacionais/fixas por competência
 *     (Contas a Pagar por vencimento). NÃO depende de import de extrato/CSV.
 *   - CAIXA (`calcularDreCaixa`): o DRE histórico — resultado por DATA DO
 *     RECEBIMENTO/PAGAMENTO (ContaReceber RECEBIDA, ContaPagar PAGA,
 *     Movimentação manual). Lógica preservada da rota original, sem alteração
 *     de comportamento.
 *
 * IMPORTANTE — isolamento do Dashboard E-commerce:
 *   este módulo NÃO importa nada privado de `dashboard-ecommerce/service.ts`
 *   nem escreve em campos de `VendaAmazon`. Reaproveita apenas helpers
 *   públicos compartilhados (filtros, valores, fee-estimator, imposto-simples,
 *   ads-aggregation), exatamente os mesmos que o Dashboard usa — garantindo
 *   consistência sem acoplamento.
 */
import { db } from "@/lib/db";
import {
  normalizarStatus,
  whereVendaAmazonContabilizavelEstrito,
  whereVendaAmazonEspelhoGestorSeller,
} from "@/modules/vendas/filtros";
import {
  calcularImpostoSimplesCentavos,
  normalizarQuantidadeVenda,
  valorBrutoDaVenda,
  valorLiquidoMarketplaceDaVenda,
} from "@/modules/vendas/valores";
import { getConfigImpostoSimples } from "@/modules/configuracao/imposto-simples";
import {
  calcularFeesLocal,
  estimarFeesVenda,
  loadFeeEstimatorConfig,
} from "@/modules/produtos/fee-estimator";
import { getAdsResumo, type FonteAds } from "@/modules/amazon/ads-aggregation";
import { contasFixasService } from "@/modules/contas-fixas/service";

// ── Tipos ───────────────────────────────────────────────────────────────────
export type OrigemTaxasDre = "real" | "estimado" | "misto" | "nenhuma";

export type DreLinhaDespesa = { categoria: string; valor: number };

/**
 * Resultado do DRE por competência (sem `regime`/`periodo`, que a rota injeta).
 * Inclui chaves "legadas" (`totalReceitas`, `receitaLiquida`, `margemBruta`,
 * `percentualMargemBruta`, `custoMercadorias`, `resultadoFinal`, `roi`) para
 * que a tabela comparativa anual renderize ambos os regimes sem ramificar.
 */
export type DreCompetenciaAgregado = {
  // Receita
  receitaBrutaVendas: number;
  reembolsos: number;
  receitaLiquidaVendas: number;

  // Deduções
  taxasAmazon: number;
  fretes: number;
  impostoSimples: number;
  receitaOperacionalLiquida: number;

  // CMV
  cmv: number;
  custoIncompleto: boolean;
  vendasSemCusto: number;
  lucroBruto: number;
  margemBrutaPercentual: number;

  // Despesas
  ads: number;
  adsFonte: FonteAds;
  despesasOperacionais: DreLinhaDespesa[];
  totalDespesasOperacionais: number;
  lucroOperacional: number;

  // Outras (lançamentos manuais)
  outrasReceitasManuais: number;
  outrasDespesasManuais: number;
  lucroLiquido: number;
  margemLiquidaPercentual: number;

  // Meta / transparência
  origemTaxas: OrigemTaxasDre;
  quantidadeVendas: number;
  unidades: number;

  // Compatibilidade com a tabela anual (mesmas chaves do regime caixa)
  totalReceitas: number;
  receitaLiquida: number;
  margemBruta: number;
  percentualMargemBruta: number;
  custoMercadorias: number;
  resultadoFinal: number;
  roi: number;
};

/** Uma linha de venda já com taxas/imposto/custo resolvidos (entrada do agregador puro). */
export type LinhaDreVenda = {
  bruto: number;
  taxas: number;
  taxasEstimada: boolean;
  frete: number;
  imposto: number;
  custo: number | null;
  quantidade: number;
};

export type ExtrasDreCompetencia = {
  reembolsos: number;
  /** Taxas devolvidas pela Amazon em reembolsos — creditadas de volta nas Taxas Amazon. */
  taxasReembolsadas: number;
  ads: number;
  adsFonte: FonteAds;
  despesasOperacionais: DreLinhaDespesa[];
  outrasReceitasManuais: number;
  outrasDespesasManuais: number;
  /** Pedidos únicos (amazonOrderId) no período — alinha a contagem com o Dashboard. */
  pedidosUnicos: number;
};

// ── Agregador PURO (sem I/O — base dos testes unitários) ──────────────────────
/**
 * Monta o DRE por competência a partir de linhas de venda já resolvidas e dos
 * extras (reembolsos, ads, despesas, manuais). Função pura: toda a aritmética
 * do DRE vive aqui, fácil de testar sem mock de banco.
 */
export function agregarDreCompetencia(
  linhas: LinhaDreVenda[],
  extras: ExtrasDreCompetencia,
): DreCompetenciaAgregado {
  let receitaBrutaVendas = 0;
  let taxasAmazonBruta = 0;
  let fretes = 0;
  let impostoSimples = 0;
  let cmv = 0;
  let unidades = 0;
  let vendasSemCusto = 0;
  let linhasReais = 0;
  let linhasEstimadas = 0;

  for (const l of linhas) {
    receitaBrutaVendas += l.bruto;
    taxasAmazonBruta += l.taxas;
    fretes += l.frete;
    impostoSimples += l.imposto;
    unidades += l.quantidade;
    if (l.custo == null) vendasSemCusto += 1;
    else cmv += l.custo;
    if (l.taxasEstimada) linhasEstimadas += 1;
    else if (l.taxas > 0) linhasReais += 1;
  }

  // Taxas líquidas: credita de volta o que a Amazon devolveu em reembolsos
  // (simetria com o regime de caixa). Clamp em 0 para nunca virar crédito.
  const taxasAmazon = Math.max(0, taxasAmazonBruta - extras.taxasReembolsadas);

  const reembolsos = extras.reembolsos;
  const receitaLiquidaVendas = receitaBrutaVendas - reembolsos;
  const receitaOperacionalLiquida =
    receitaLiquidaVendas - taxasAmazon - fretes - impostoSimples;
  const lucroBruto = receitaOperacionalLiquida - cmv;
  const margemBrutaPercentual =
    receitaOperacionalLiquida > 0
      ? (lucroBruto / receitaOperacionalLiquida) * 100
      : 0;

  const totalDespesasOperacionais = extras.despesasOperacionais.reduce(
    (s, d) => s + d.valor,
    0,
  );
  const lucroOperacional = lucroBruto - extras.ads - totalDespesasOperacionais;

  const outras = extras.outrasReceitasManuais - extras.outrasDespesasManuais;
  const lucroLiquido = lucroOperacional + outras;
  const margemLiquidaPercentual =
    receitaBrutaVendas > 0 ? (lucroLiquido / receitaBrutaVendas) * 100 : 0;

  const origemTaxas: OrigemTaxasDre =
    linhas.length === 0
      ? "nenhuma"
      : linhasEstimadas > 0 && linhasReais > 0
        ? "misto"
        : linhasEstimadas > 0
          ? "estimado"
          : "real";

  const roi = cmv > 0 ? (lucroLiquido / cmv) * 100 : 0;

  return {
    receitaBrutaVendas,
    reembolsos,
    receitaLiquidaVendas,
    taxasAmazon,
    fretes,
    impostoSimples,
    receitaOperacionalLiquida,
    cmv,
    custoIncompleto: vendasSemCusto > 0,
    vendasSemCusto,
    lucroBruto,
    margemBrutaPercentual,
    ads: extras.ads,
    adsFonte: extras.adsFonte,
    despesasOperacionais: extras.despesasOperacionais,
    totalDespesasOperacionais,
    lucroOperacional,
    outrasReceitasManuais: extras.outrasReceitasManuais,
    outrasDespesasManuais: extras.outrasDespesasManuais,
    lucroLiquido,
    margemLiquidaPercentual,
    origemTaxas,
    quantidadeVendas: extras.pedidosUnicos,
    unidades,
    // Compatibilidade anual
    totalReceitas: receitaBrutaVendas,
    receitaLiquida: receitaOperacionalLiquida,
    margemBruta: lucroBruto,
    percentualMargemBruta: margemBrutaPercentual,
    custoMercadorias: cmv,
    resultadoFinal: lucroLiquido,
    roi,
  };
}

// ── Helpers do cálculo por competência ───────────────────────────────────────
// Status financeiro em que a Amazon ainda NÃO devolveu as taxas reais — único
// caso em que estimamos (espelha `precisaEstimativaTaxas` do dashboard).
const STATUS_TAXA_NAO_LIQUIDADA = new Set(["PENDENTE", "DEFERRED"]);

function precisaEstimativaTaxas(
  taxasCentavos: number,
  statusFinanceiro: string | null | undefined,
): boolean {
  return (
    (taxasCentavos ?? 0) <= 0 &&
    STATUS_TAXA_NAO_LIQUIDADA.has(normalizarStatus(statusFinanceiro))
  );
}

// Categorias de Contas a Pagar cujo custo JÁ entra no DRE pela via das vendas
// (CMV/taxas/frete) — não podem reaparecer como "despesa operacional" (dupla
// contagem). Normalizadas (minúsculas, sem espaço ao redor da barra).
const CATEGORIAS_EXCLUIDAS_DESPESA = new Set([
  "compra de mercadorias/produtos",
  "taxas de plataformas/pagamentos",
  "fretes e entregas",
]);

function normalizarNomeCategoria(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .trim();
}

/**
 * Calcula o DRE por competência no período [de, ate] (datas já em UTC).
 *
 * READ-ONLY: NÃO materializa contas fixas (não escreve no banco). As despesas
 * fixas vêm das Contas a Pagar já materializadas (avulsas + ocorrências geradas
 * pelas telas Contas a Pagar/Agenda); o que ainda não foi materializado entra
 * como linha "Contas fixas (previstas)", calculada de forma pura via
 * contasFixasService.totalDoPeriodo — sem efeito colateral de caixa.
 */
export async function calcularDreCompetencia(
  de: Date,
  ate: Date,
): Promise<DreCompetenciaAgregado> {
  const [
    vendas,
    reembolsosAgg,
    cfgImposto,
    cfgFee,
    adsResumo,
    contasPagar,
    movimentacoesManuais,
    fixasPlanejadas,
  ] = await Promise.all([
    // Mesmo filtro que o Dashboard E-commerce (`espelho`): inclui vendas depois
    // reembolsadas (gross), com o refund entrando como contra-receita abaixo
    // (evita a dupla penalização do filtro estrito). Exclui cancelados, removal
    // orders e Pending sem valor. Obs.: a Receita Bruta fica PRÓXIMA (não
    // idêntica) ao Faturamento do Dashboard, que remove fisicamente as vendas
    // com reembolso na janela (modelo net) em vez de gross + contra-receita.
    db.vendaAmazon.findMany({
      where: whereVendaAmazonEspelhoGestorSeller({
        dataVenda: { gte: de, lte: ate },
      }),
      select: {
        amazonOrderId: true,
        sku: true,
        quantidade: true,
        valorBrutoCentavos: true,
        precoUnitarioCentavos: true,
        taxasCentavos: true,
        fretesCentavos: true,
        liquidoMarketplaceCentavos: true,
        custoUnitarioCentavos: true,
        statusPedido: true,
        statusFinanceiro: true,
      },
    }),
    // Reembolsos reconhecidos pela dataReembolso (evento econômico do refund).
    // NÃO aplica whereAmazonReembolsoContabilizavel de propósito — paridade com
    // o regime de caixa, que também reconhece o refund na data do evento.
    db.amazonReembolso.aggregate({
      where: {
        dataReembolso: { gte: de, lte: ate },
        NOT: { motivoCategoria: "GESTOR_SELLER_VALIDATION" },
      },
      _sum: {
        valorReembolsadoCentavos: true,
        taxasReembolsadasCentavos: true,
      },
    }),
    getConfigImpostoSimples(),
    loadFeeEstimatorConfig(),
    getAdsResumo({ de, ate }),
    db.contaPagar.findMany({
      where: {
        vencimento: { gte: de, lte: ate },
        status: { not: "CANCELADA" },
        deletedAt: null,
      },
      include: { categoria: true },
    }),
    db.movimentacao.findMany({
      where: {
        origem: "MANUAL",
        dataCompetencia: { gte: de, lte: ate },
        deletedAt: null,
      },
      select: { tipo: true, valor: true },
    }),
    // Total de contas fixas PLANEJADAS no período (cálculo puro, não escreve).
    contasFixasService.totalDoPeriodo({ de, ate }),
  ]);

  // Vendas ainda não liquidadas (DEFERRED/PENDENTE sem taxa real) recebem
  // estimativa de taxas — mesmas regras do dashboard.
  const candidatas = vendas.filter((v) =>
    precisaEstimativaTaxas(v.taxasCentavos, v.statusFinanceiro),
  );
  const skusCandidatas = new Set(candidatas.map((v) => v.sku));
  const produtos =
    skusCandidatas.size > 0
      ? await db.produto.findMany({
          where: { sku: { in: [...skusCandidatas] } },
          select: { id: true, sku: true, amazonCategoriaFee: true },
        })
      : [];
  const produtoBySku = new Map(
    produtos.map((p) => [
      p.sku,
      { id: p.id, categoriaSlug: p.amazonCategoriaFee },
    ]),
  );

  const linhas: LinhaDreVenda[] = await Promise.all(
    vendas.map(async (v): Promise<LinhaDreVenda> => {
      const bruto = valorBrutoDaVenda(v);
      const quantidade = normalizarQuantidadeVenda(v.quantidade);

      let taxas = Math.max(0, v.taxasCentavos ?? 0);
      let taxasEstimada = false;
      if (precisaEstimativaTaxas(v.taxasCentavos, v.statusFinanceiro)) {
        const produto = produtoBySku.get(v.sku);
        if (produto) {
          const est = await estimarFeesVenda({
            produtoId: produto.id,
            valorBrutoCentavos: bruto,
            quantidade,
            taxasReaisCentavos: 0,
            categoriaSlug: produto.categoriaSlug,
            cfg: cfgFee,
          });
          taxas = est.taxasCentavos;
          taxasEstimada = est.origem !== "real";
        } else {
          // SKU sem produto cadastrado: usa comissão default (sem categoria),
          // para não subestimar deduções nem ocultar o selo "estimado".
          const local = calcularFeesLocal(bruto, quantidade, cfgFee, {
            categoriaSlug: null,
          });
          taxas =
            local.comissaoCentavos +
            local.fbaCentavos +
            local.closingFeeCentavos;
          taxasEstimada = true;
        }
      }

      const imposto = calcularImpostoSimplesCentavos({
        valorBrutoCentavos: bruto,
        aliquotaBps: cfgImposto.aliquotaBps,
        ativo: cfgImposto.ativo,
        statusPedido: v.statusPedido,
        statusFinanceiro: v.statusFinanceiro,
      });

      const custoUnit = v.custoUnitarioCentavos ?? 0;
      const custo = custoUnit > 0 ? custoUnit * quantidade : null;

      return {
        bruto,
        taxas,
        taxasEstimada,
        frete: Math.max(0, v.fretesCentavos ?? 0),
        imposto,
        custo,
        quantidade,
      };
    }),
  );

  // Despesas operacionais/fixas por competência (vencimento), agrupadas por
  // categoria e excluindo o que já entra via vendas (CMV/taxas/frete). Quando o
  // Simples é calculado por venda, "Impostos" também é excluído para não contar
  // o DAS duas vezes.
  const excluidas = new Set(CATEGORIAS_EXCLUIDAS_DESPESA);
  if (cfgImposto.ativo && cfgImposto.aliquotaBps > 0) {
    excluidas.add("impostos");
  }
  const porCategoria = new Map<string, number>();
  for (const cp of contasPagar) {
    const nome = cp.categoria?.nome ?? "Outros";
    if (excluidas.has(normalizarNomeCategoria(nome))) continue;
    porCategoria.set(nome, (porCategoria.get(nome) ?? 0) + cp.valor);
  }

  // Contas fixas ainda NÃO materializadas no período entram por cálculo puro
  // (planejado − já materializado), sem escrever no banco. Evita subreporte das
  // despesas fixas em meses não abertos em Contas a Pagar/Agenda.
  const fixasMaterializadasTotal = contasPagar
    .filter((cp) => cp.contaFixaId != null)
    .reduce((s, cp) => s + cp.valor, 0);
  const fixasPrevistas = Math.max(
    0,
    fixasPlanejadas.totalCentavos - fixasMaterializadasTotal,
  );

  const despesasOperacionais: DreLinhaDespesa[] = [
    ...porCategoria.entries(),
  ].map(([categoria, valor]) => ({ categoria, valor }));
  if (fixasPrevistas > 0) {
    despesasOperacionais.push({
      categoria: "Contas fixas (previstas)",
      valor: fixasPrevistas,
    });
  }
  despesasOperacionais.sort((a, b) => b.valor - a.valor);

  const outrasReceitasManuais = movimentacoesManuais
    .filter((m) => m.tipo === "ENTRADA")
    .reduce((s, m) => s + m.valor, 0);
  const outrasDespesasManuais = movimentacoesManuais
    .filter((m) => m.tipo === "SAIDA")
    .reduce((s, m) => s + m.valor, 0);

  const pedidosUnicos = new Set(vendas.map((v) => v.amazonOrderId)).size;

  return agregarDreCompetencia(linhas, {
    reembolsos: reembolsosAgg._sum.valorReembolsadoCentavos ?? 0,
    taxasReembolsadas: reembolsosAgg._sum.taxasReembolsadasCentavos ?? 0,
    ads: adsResumo.gastoCentavos,
    adsFonte: adsResumo.fonte,
    despesasOperacionais,
    outrasReceitasManuais,
    outrasDespesasManuais,
    pedidosUnicos,
  });
}

// ── Regime de CAIXA (lógica histórica, preservada verbatim) ───────────────────
/**
 * DRE por regime de caixa — resultado por data de recebimento/pagamento.
 * Lógica idêntica à rota original (`/api/dre/resumo`), apenas movida para cá
 * para ficar testável e conviver com o regime de competência.
 */
export async function calcularDreCaixa(de: Date, ate: Date) {
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
      where: {
        status: "RECEBIDA",
        dataRecebimento: { gte: de, lte: ate },
        deletedAt: null,
      },
      select: { valor: true },
    }),
    db.movimentacao.findMany({
      where: {
        tipo: "ENTRADA",
        origem: "MANUAL",
        dataCaixa: { gte: de, lte: ate },
        deletedAt: null,
      },
      select: { valor: true, categoria: { select: { nome: true } } },
    }),
    db.contaPagar.findMany({
      where: {
        status: "PAGA",
        pagoEm: { gte: de, lte: ate },
        deletedAt: null,
      },
      include: { categoria: true },
    }),
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
      where: {
        dataReembolso: { gte: de, lte: ate },
        NOT: { motivoCategoria: "GESTOR_SELLER_VALIDATION" },
      },
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

  // Soma por nome de categoria NORMALIZADO (com/sem espaço ao redor da barra).
  // Os nomes do seed têm espaços ("Taxas de plataformas / pagamentos"); o lookup
  // exato sem espaço falhava e zerava deduções/CMV no regime de caixa (bug
  // pré-existente corrigido na Onda 2).
  const somaCategoria = (alvo: string) => {
    const alvoNorm = normalizarNomeCategoria(alvo);
    return Object.entries(porCategoria).reduce(
      (s, [nome, v]) => (normalizarNomeCategoria(nome) === alvoNorm ? s + v : s),
      0,
    );
  };

  const taxasPlataforma = somaCategoria("Taxas de plataformas / pagamentos");
  const fretes = somaCategoria("Fretes e entregas");
  const totalDeducoes = taxasPlataforma + fretes + returnsEstimados;
  const receitaLiquida = totalReceitas - totalDeducoes;

  const custoMercadoriasBase = somaCategoria("Compra de mercadorias / produtos");
  const custoMercadorias = custoMercadoriasBase + storageFees;
  const margemBruta = receitaLiquida - custoMercadorias;
  const percentualMargemBruta =
    receitaLiquida > 0 ? (margemBruta / receitaLiquida) * 100 : 0;

  const excluirNorm = new Set(
    [
      "Compra de mercadorias / produtos",
      "Taxas de plataformas / pagamentos",
      "Fretes e entregas",
    ].map(normalizarNomeCategoria),
  );

  const despesaMarketing = somaCategoria("Marketing");

  const despesasOperacionais = Object.entries(porCategoria)
    .filter(([cat]) => !excluirNorm.has(normalizarNomeCategoria(cat)))
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);

  const totalDespesas = despesasOperacionais.reduce((s, d) => s + d.valor, 0);
  const resultadoOperacional = margemBruta - totalDespesas;

  const roi =
    custoMercadorias > 0 ? (resultadoOperacional / custoMercadorias) * 100 : 0;
  const mpaValor = margemBruta - despesaMarketing;
  const mpaPercentual =
    totalReceitas > 0 ? (mpaValor / totalReceitas) * 100 : 0;

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
  const adsTotal =
    adsSyncGasto > 0 ? adsSyncGasto : adsCampanhasCentavos + adsManualCentavos;

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

    amazon: {
      vendasBrutas: vendasAmazonBrutas,
      vendasLiquidas: vendasAmazonLiquidas,
      taxas: taxasAmazon,
      fretes: fretesAmazon,
      reembolsos: reembolsosValor,
      reembolsosTaxas,
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
