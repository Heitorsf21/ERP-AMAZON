import {
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
