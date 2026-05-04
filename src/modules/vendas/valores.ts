export type VendaAmazonValoresInput = {
  quantidade?: number | null;
  precoUnitarioCentavos?: number | null;
  valorBrutoCentavos?: number | null;
  taxasCentavos?: number | null;
  fretesCentavos?: number | null;
  liquidoMarketplaceCentavos?: number | null;
};

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
