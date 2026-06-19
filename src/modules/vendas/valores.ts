import {
  PRECO_ORIGEM_LISTING,
  PRECO_ORIGEM_REPLACEMENT,
  PRECO_ORIGEM_SPAPI,
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
 * 3. Sem ItemPrice, mas com preco de listagem → fallback `listing` (estimado).
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

  if (valorBrutoFinal > 0) {
    precoOrigemFinal = PRECO_ORIGEM_SPAPI;
  } else if (input.precoListagemCentavos && input.precoListagemCentavos > 0) {
    valorBrutoFinal = input.precoListagemCentavos * item.quantidade;
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
