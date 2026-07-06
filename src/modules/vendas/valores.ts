import {
  PRECO_ORIGEM_LISTING,
  PRECO_ORIGEM_REPLACEMENT,
  PRECO_ORIGEM_SPAPI,
  STATUS_PEDIDO_CANCELADO_NORMALIZADO,
  STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO,
  STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO,
  normalizarStatus,
} from "./filtros";

export type VendaAmazonValoresInput = {
  quantidade?: number | null;
  precoUnitarioCentavos?: number | null;
  valorBrutoCentavos?: number | null;
  taxasCentavos?: number | null;
  fretesCentavos?: number | null;
  liquidoMarketplaceCentavos?: number | null;
};

export type ImpostoSimplesInput = {
  valorBrutoCentavos: number;
  aliquotaBps: number;
  ativo: boolean;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
};

/**
 * Calcula o imposto Simples Nacional sobre o valor bruto da venda.
 *
 * Regras:
 * - Retorna 0 se a configuracao estiver desativada.
 * - Retorna 0 quando a venda esta marcada como REEMBOLSADA (em qualquer um
 *   dos dois campos de status), refletindo que o DAS e abatido no proximo
 *   mes.
 * - Retorna 0 quando o pedido esta CANCELADO — nao houve receita, nao ha
 *   fato gerador (higiene de dado: cancelados ficam fora dos agregados, mas
 *   o campo gravado nao deve carregar imposto fantasma).
 * - Caso contrario, aplica `valorBruto * aliquotaBps / 10_000` com
 *   arredondamento half-away-from-zero (Math.round).
 *
 * O valor e SEMPRE expresso em centavos.
 */
export function calcularImpostoSimplesCentavos(
  input: ImpostoSimplesInput,
): number {
  if (!input.ativo) return 0;
  if (input.aliquotaBps <= 0) return 0;
  if (!Number.isFinite(input.valorBrutoCentavos) || input.valorBrutoCentavos <= 0) {
    return 0;
  }
  const statusPedido = normalizarStatus(input.statusPedido ?? "");
  const statusFinanceiro = normalizarStatus(input.statusFinanceiro ?? "");
  if (
    STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO.has(statusPedido) ||
    STATUS_PEDIDO_CANCELADO_NORMALIZADO.has(statusPedido) ||
    STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO.has(statusFinanceiro)
  ) {
    return 0;
  }
  return Math.round(input.valorBrutoCentavos * input.aliquotaBps / 10_000);
}

export type ValoresLinhaVendaAmazon = {
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number;
};

export function normalizarQuantidadeVenda(quantidade?: number | null): number {
  const valor = Math.trunc(Number(quantidade));
  return Number.isFinite(valor) && valor > 0 ? valor : 1;
}

export function normalizarCentavos(valor?: number | null): number {
  const centavos = Math.round(Number(valor));
  return Number.isFinite(centavos) ? centavos : 0;
}

export function calcularPrecoUnitarioCentavos(
  valorBrutoCentavos: number,
  quantidade?: number | null,
): number {
  const qtd = normalizarQuantidadeVenda(quantidade);
  return Math.round(normalizarCentavos(valorBrutoCentavos) / qtd);
}

export function valorBrutoDaVenda(venda: VendaAmazonValoresInput): number {
  if (venda.valorBrutoCentavos != null) {
    return normalizarCentavos(venda.valorBrutoCentavos);
  }

  return (
    normalizarCentavos(venda.precoUnitarioCentavos) *
    normalizarQuantidadeVenda(venda.quantidade)
  );
}

export function valorLiquidoMarketplaceDaVenda(
  venda: VendaAmazonValoresInput,
): number {
  if (venda.liquidoMarketplaceCentavos != null) {
    return normalizarCentavos(venda.liquidoMarketplaceCentavos);
  }

  return (
    valorBrutoDaVenda(venda) -
    normalizarCentavos(venda.taxasCentavos) -
    normalizarCentavos(venda.fretesCentavos)
  );
}

export function calcularValoresLinhaVendaAmazon(input: {
  quantidade?: number | null;
  valorBrutoCentavos?: number | null;
  taxasCentavos?: number | null;
  fretesCentavos?: number | null;
  liquidoMarketplaceCentavos?: number | null;
}): ValoresLinhaVendaAmazon {
  const quantidade = normalizarQuantidadeVenda(input.quantidade);
  const valorBrutoCentavos = normalizarCentavos(input.valorBrutoCentavos);
  const taxasCentavos = normalizarCentavos(input.taxasCentavos);
  const fretesCentavos = normalizarCentavos(input.fretesCentavos);
  const liquidoMarketplaceCentavos =
    input.liquidoMarketplaceCentavos == null
      ? valorBrutoCentavos - taxasCentavos - fretesCentavos
      : normalizarCentavos(input.liquidoMarketplaceCentavos);

  return {
    quantidade,
    precoUnitarioCentavos: calcularPrecoUnitarioCentavos(
      valorBrutoCentavos,
      quantidade,
    ),
    valorBrutoCentavos,
    taxasCentavos,
    fretesCentavos,
    liquidoMarketplaceCentavos,
  };
}

export type ResolverPrecoVendaInput = {
  /** `true` quando o pedido e uma reposicao/substituicao (replacement order). */
  isReplacement: boolean;
  item: {
    quantidade: number;
    valorBrutoCentavos: number;
    taxasCentavos: number;
    fretesCentavos: number;
    liquidoMarketplaceCentavos: number;
  };
  /** `Produto.amazonPrecoListagemCentavos` — base do fallback estimado. */
  precoListagemCentavos?: number | null;
  /**
   * Preco unitario REAL mais recente do SKU (vendas `sp-api` dos ultimos dias).
   * Fallback PREFERIDO sobre o listing: acompanha ofertas ativas que a Listings
   * API nao expoe (deals do console de Promocoes nao aparecem em
   * `purchasable_offer.discounted_price`).
   */
  precoRealRecenteCentavos?: number | null;
  existente?: {
    valorBrutoCentavos?: number | null;
    precoOrigem?: string | null;
    taxasCentavos?: number | null;
    fretesCentavos?: number | null;
    liquidoMarketplaceCentavos?: number | null;
  } | null;
};

export type PrecoVendaResolvido = {
  valorBrutoCentavos: number;
  precoOrigem: string | null;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number;
};

/**
 * Decide `valorBruto`/`precoOrigem`/taxas/frete/liquido de uma linha de venda
 * Amazon a partir do item recem-sincronizado, do preco de listagem (fallback)
 * e do registro existente. Funcao pura — extraida do sync de Orders para ser
 * testavel.
 *
 * Regras (em ordem):
 * 1. REPOSICAO (replacement order): preco real = R$0 (a Amazon nao cobra o
 *    cliente). Marca `precoOrigem = "replacement"` e NUNCA estima via listing.
 *    Uma venda que ja era reposicao permanece reposicao.
 * 2. ItemPrice real da SP-API (> 0) → `sp-api`.
 * 3. Sem ItemPrice → fallback `listing` (estimado), preferindo o preco REAL
 *    recente do SKU (acompanha ofertas ativas) e caindo no preco de listagem
 *    quando nao ha venda real recente.
 * 4. Sem nada novo → preserva o que ja existia.
 * 5. Nunca regride `sp-api` para `listing`.
 */
export function resolverPrecoVendaAmazon(
  input: ResolverPrecoVendaInput,
): PrecoVendaResolvido {
  const { item, existente } = input;
  const ehReposicao =
    input.isReplacement || existente?.precoOrigem === PRECO_ORIGEM_REPLACEMENT;

  if (ehReposicao) {
    return {
      valorBrutoCentavos: 0,
      precoOrigem: PRECO_ORIGEM_REPLACEMENT,
      taxasCentavos: 0,
      fretesCentavos: 0,
      liquidoMarketplaceCentavos: 0,
    };
  }

  let valorBrutoFinal = item.valorBrutoCentavos;
  let precoOrigemFinal: string | null = null;
  let taxasFinal = item.taxasCentavos;
  let fretesFinal = item.fretesCentavos;
  let liquidoFinal = item.liquidoMarketplaceCentavos;

  const precoEstimadoCentavos =
    input.precoRealRecenteCentavos && input.precoRealRecenteCentavos > 0
      ? input.precoRealRecenteCentavos
      : input.precoListagemCentavos;

  if (valorBrutoFinal > 0) {
    precoOrigemFinal = PRECO_ORIGEM_SPAPI;
  } else if (precoEstimadoCentavos && precoEstimadoCentavos > 0) {
    valorBrutoFinal = precoEstimadoCentavos * item.quantidade;
    precoOrigemFinal = PRECO_ORIGEM_LISTING;
    taxasFinal = 0;
    fretesFinal = 0;
    liquidoFinal = valorBrutoFinal;
  } else if (existente?.valorBrutoCentavos && existente.valorBrutoCentavos > 0) {
    valorBrutoFinal = existente.valorBrutoCentavos;
    precoOrigemFinal = existente.precoOrigem ?? null;
    taxasFinal = existente.taxasCentavos ?? 0;
    fretesFinal = existente.fretesCentavos ?? 0;
    liquidoFinal =
      existente.liquidoMarketplaceCentavos ?? valorBrutoFinal - taxasFinal;
  }

  // Nao regredir "sp-api" -> "listing".
  if (
    existente?.precoOrigem === PRECO_ORIGEM_SPAPI &&
    precoOrigemFinal === PRECO_ORIGEM_LISTING
  ) {
    valorBrutoFinal = existente.valorBrutoCentavos ?? valorBrutoFinal;
    precoOrigemFinal = PRECO_ORIGEM_SPAPI;
    taxasFinal = existente.taxasCentavos ?? taxasFinal;
    fretesFinal = existente.fretesCentavos ?? fretesFinal;
    liquidoFinal =
      existente.liquidoMarketplaceCentavos ?? valorBrutoFinal - taxasFinal;
  }

  return {
    valorBrutoCentavos: valorBrutoFinal,
    precoOrigem: precoOrigemFinal,
    taxasCentavos: taxasFinal,
    fretesCentavos: fretesFinal,
    liquidoMarketplaceCentavos: liquidoFinal,
  };
}

export type PreservarFinanceiroInput = {
  /** `precoOrigem` decidido pelo resolver para ESTA re-visita do Orders. */
  precoOrigem: string | null;
  /** Bruto decidido pelo resolver (novo valor a gravar). */
  valorBrutoNovoCentavos: number;
  /** Taxas trazidas pelo Orders (ItemTax+ShippingTax — ~R$0 no BR). */
  taxasOrdersCentavos: number;
  existente?: {
    statusFinanceiro?: string | null;
    valorBrutoCentavos?: number | null;
    taxasCentavos?: number | null;
    fretesCentavos?: number | null;
    liquidoMarketplaceCentavos?: number | null;
  } | null;
};

/**
 * Decide se a RE-VISITA do ORDERS_SYNC deve preservar taxas/frete/líquido
 * REAIS já gravados pelo Finance. A Orders API só expõe ItemTax/ShippingTax
 * (~R$0 no BR); reescrever com isso apagava a taxa real (Commission+FBA+
 * parcelamento) sempre que o pedido era re-tocado (mudança de status/refund),
 * inflando o líquido até o próximo FINANCES_SYNC.
 *
 * Preserva SOMENTE quando: preço real ("sp-api") + Finance já confirmou a
 * venda (statusFinanceiro != PENDENTE) com taxa real > 0 + Orders não trouxe
 * taxa maior + o bruto NÃO mudou (bruto novo ⇒ deixa o Finance re-reconciliar
 * no próximo ciclo em vez de casar taxa velha com bruto novo).
 */
export function preservarFinanceiroRealNaRevisita(
  input: PreservarFinanceiroInput,
): {
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number;
} | null {
  const existente = input.existente;
  if (!existente) return null;
  if (input.precoOrigem !== PRECO_ORIGEM_SPAPI) return null;

  const statusFinanceiro = normalizarStatus(existente.statusFinanceiro ?? "");
  if (!statusFinanceiro || statusFinanceiro === "PENDENTE") return null;

  const taxasReais = normalizarCentavos(existente.taxasCentavos);
  if (taxasReais <= 0) return null;
  if (normalizarCentavos(input.taxasOrdersCentavos) > taxasReais) return null;

  const brutoExistente = normalizarCentavos(existente.valorBrutoCentavos);
  if (brutoExistente !== normalizarCentavos(input.valorBrutoNovoCentavos)) {
    return null;
  }

  return {
    taxasCentavos: taxasReais,
    fretesCentavos: normalizarCentavos(existente.fretesCentavos),
    liquidoMarketplaceCentavos:
      existente.liquidoMarketplaceCentavos == null
        ? brutoExistente - taxasReais
        : normalizarCentavos(existente.liquidoMarketplaceCentavos),
  };
}

export function valorBrutoFinanceiroPodeAtualizar(input: {
  valorBrutoAtualCentavos?: number | null;
  quantidadeAtual?: number | null;
  valorBrutoFinanceiroCentavos?: number | null;
}): boolean {
  const financeiro = normalizarCentavos(input.valorBrutoFinanceiroCentavos);
  if (financeiro <= 0) return false;

  const atual =
    input.valorBrutoAtualCentavos == null
      ? null
      : normalizarCentavos(input.valorBrutoAtualCentavos);
  if (atual == null || atual <= 0) return true;
  if (financeiro === atual) return false;

  const quantidadeAtual = normalizarQuantidadeVenda(input.quantidadeAtual);
  if (quantidadeAtual <= 1) return true;

  return financeiro > atual;
}
