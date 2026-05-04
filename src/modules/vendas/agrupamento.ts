import {
  calcularValoresLinhaVendaAmazon,
  normalizarCentavos,
  normalizarQuantidadeVenda,
} from "@/modules/vendas/valores";

export type LinhaVendaAmazonFonte = {
  amazonOrderId: string;
  sku: string;
  quantidade: number;
  valorBrutoCentavos: number;
  taxasCentavos?: number | null;
  fretesCentavos?: number | null;
  liquidoMarketplaceCentavos?: number | null;
};

export function chaveVendaAmazon(
  amazonOrderId: string,
  sku: string,
): string {
  return `${amazonOrderId}\u0000${sku}`;
}

export function agruparLinhasVendaAmazon<T extends LinhaVendaAmazonFonte>(
  linhas: T[],
): Array<T & ReturnType<typeof calcularValoresLinhaVendaAmazon>> {
  const grupos = new Map<string, T & ReturnType<typeof calcularValoresLinhaVendaAmazon>>();

  for (const linha of linhas) {
    const key = chaveVendaAmazon(linha.amazonOrderId, linha.sku);
    const existente = grupos.get(key);
    if (!existente) {
      grupos.set(key, {
        ...linha,
        ...calcularValoresLinhaVendaAmazon(linha),
      });
      continue;
    }

    const valores = calcularValoresLinhaVendaAmazon({
      quantidade:
        normalizarQuantidadeVenda(existente.quantidade) +
        normalizarQuantidadeVenda(linha.quantidade),
      valorBrutoCentavos:
        normalizarCentavos(existente.valorBrutoCentavos) +
        normalizarCentavos(linha.valorBrutoCentavos),
      taxasCentavos:
        normalizarCentavos(existente.taxasCentavos) +
        normalizarCentavos(linha.taxasCentavos),
      fretesCentavos:
        normalizarCentavos(existente.fretesCentavos) +
        normalizarCentavos(linha.fretesCentavos),
      liquidoMarketplaceCentavos:
        existente.liquidoMarketplaceCentavos == null &&
        linha.liquidoMarketplaceCentavos == null
          ? null
          : normalizarCentavos(existente.liquidoMarketplaceCentavos) +
            normalizarCentavos(linha.liquidoMarketplaceCentavos),
    });

    grupos.set(key, {
      ...existente,
      ...valores,
    });
  }

  return [...grupos.values()];
}
