import { normalizarCentavos } from "@/modules/vendas/valores";

export type LinhaFinanceiraVendaAmazon = {
  amazonOrderId: string;
  sku: string;
  valorBrutoCentavos: number;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number | null;
  liquidacaoId?: string | null;
  statusFinanceiro?: string | null;
};

export type ValoresFinanceirosVendaAmazon = LinhaFinanceiraVendaAmazon;

function key(orderId: string, sku: string): string {
  return `${orderId}\u0000${sku}`;
}

export function agruparValoresFinanceirosVendaAmazon(
  linhas: LinhaFinanceiraVendaAmazon[],
): ValoresFinanceirosVendaAmazon[] {
  const map = new Map<string, ValoresFinanceirosVendaAmazon>();

  for (const linha of linhas) {
    const k = key(linha.amazonOrderId, linha.sku);
    const existente = map.get(k);
    if (!existente) {
      map.set(k, {
        amazonOrderId: linha.amazonOrderId,
        sku: linha.sku,
        valorBrutoCentavos: normalizarCentavos(linha.valorBrutoCentavos),
        taxasCentavos: normalizarCentavos(linha.taxasCentavos),
        fretesCentavos: normalizarCentavos(linha.fretesCentavos),
        liquidoMarketplaceCentavos:
          linha.liquidoMarketplaceCentavos == null
            ? null
            : normalizarCentavos(linha.liquidoMarketplaceCentavos),
        liquidacaoId: linha.liquidacaoId ?? null,
        statusFinanceiro: linha.statusFinanceiro ?? null,
      });
      continue;
    }

    existente.valorBrutoCentavos += normalizarCentavos(
      linha.valorBrutoCentavos,
    );
    existente.taxasCentavos += normalizarCentavos(linha.taxasCentavos);
    existente.fretesCentavos += normalizarCentavos(linha.fretesCentavos);
    existente.liquidoMarketplaceCentavos =
      existente.liquidoMarketplaceCentavos == null &&
      linha.liquidoMarketplaceCentavos == null
        ? null
        : normalizarCentavos(existente.liquidoMarketplaceCentavos) +
          normalizarCentavos(linha.liquidoMarketplaceCentavos);
    existente.liquidacaoId = linha.liquidacaoId ?? existente.liquidacaoId;
    existente.statusFinanceiro =
      linha.statusFinanceiro ?? existente.statusFinanceiro;
  }

  return [...map.values()];
}
