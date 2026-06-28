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

/**
 * Reconcilia `taxas`/`liquido` de um evento Finance para o BRUTO CHEIO do pedido.
 *
 * Por que: a Finance API entrega a taxa por evento de liquidação (muitas vezes
 * de 1 unidade), enquanto `VendaAmazon.valorBrutoCentavos` vem do sync de Orders
 * com o pedido INTEIRO. Gravar a taxa do evento direto deixava `liquido` de 1
 * unidade contra um `bruto` de N unidades — quebrando `liquido = bruto - taxas`
 * e gerando lucro/margem negativos falsos no dashboard (e DRE) para pedidos
 * multi-unidade.
 *
 * Como as taxas da Amazon são lineares (comissão %, FBA por unidade,
 * parcelamento %), aplicamos a TAXA REAL do evento (`taxas / baseBruto`) sobre o
 * bruto cheio. O resultado é o valor REAL da taxa do pedido inteiro (não é
 * estimativa) e o invariante `taxas + liquido = bruto` é restaurado. Idempotente:
 * qualquer evento (1 unidade ou N) produz o mesmo resultado cheio, então o
 * "last-write-wins" do sync deixa de ser um problema.
 */
export function reconciliarFinanceiroParaBrutoCheio(input: {
  /** Bruto do pedido inteiro (fonte: sync de Orders). */
  brutoCheioCentavos: number;
  /** Taxas trazidas pelo evento Finance (referentes a `baseBrutoCentavos`). */
  taxasCentavos: number;
  /** Bruto (ProductCharges) que as `taxasCentavos` representam no evento. */
  baseBrutoCentavos: number;
}): { taxasCentavos: number; liquidoMarketplaceCentavos: number } {
  const brutoCheio = normalizarCentavos(input.brutoCheioCentavos);
  if (brutoCheio <= 0) {
    return { taxasCentavos: 0, liquidoMarketplaceCentavos: 0 };
  }

  const taxas = normalizarCentavos(input.taxasCentavos);
  const base = normalizarCentavos(input.baseBrutoCentavos);

  // Sem base confiável para derivar a taxa: mantém as taxas (clampadas a [0,bruto])
  // e apenas garante o invariante liquido = bruto - taxas.
  if (base <= 0) {
    const taxasClamp = Math.min(Math.max(taxas, 0), brutoCheio);
    return {
      taxasCentavos: taxasClamp,
      liquidoMarketplaceCentavos: brutoCheio - taxasClamp,
    };
  }

  const taxasCheias = Math.round((brutoCheio * taxas) / base);
  const taxasClamp = Math.min(Math.max(taxasCheias, 0), brutoCheio);
  return {
    taxasCentavos: taxasClamp,
    liquidoMarketplaceCentavos: brutoCheio - taxasClamp,
  };
}
