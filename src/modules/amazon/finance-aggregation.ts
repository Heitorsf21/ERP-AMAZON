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
  /**
   * Frete trazido pelo evento Finance (mesma base do evento). Re-escalado pelo
   * MESMO fator das taxas — antes o frete de 1 unidade era gravado contra o
   * bruto de N unidades no multi-unidade.
   */
  fretesCentavos?: number;
}): {
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number;
} {
  const brutoCheio = normalizarCentavos(input.brutoCheioCentavos);
  if (brutoCheio <= 0) {
    return { taxasCentavos: 0, fretesCentavos: 0, liquidoMarketplaceCentavos: 0 };
  }

  const taxas = normalizarCentavos(input.taxasCentavos);
  const base = normalizarCentavos(input.baseBrutoCentavos);
  const fretes = normalizarCentavos(input.fretesCentavos);

  // Sem base confiável para derivar a taxa: mantém as taxas (clampadas a [0,bruto])
  // e apenas garante o invariante liquido = bruto - taxas.
  if (base <= 0) {
    const taxasClamp = Math.min(Math.max(taxas, 0), brutoCheio);
    return {
      taxasCentavos: taxasClamp,
      fretesCentavos: Math.max(fretes, 0),
      liquidoMarketplaceCentavos: brutoCheio - taxasClamp,
    };
  }

  const taxasCheias = Math.round((brutoCheio * taxas) / base);
  const taxasClamp = Math.min(Math.max(taxasCheias, 0), brutoCheio);
  const fretesCheios = Math.max(Math.round((brutoCheio * fretes) / base), 0);
  return {
    taxasCentavos: taxasClamp,
    fretesCentavos: fretesCheios,
    liquidoMarketplaceCentavos: brutoCheio - taxasClamp,
  };
}

/**
 * Desconto promocional de PRODUTO (cupom/desconto financiado pelo seller) de
 * um item da Transactions API v2024: breakdown top-level `PromoRebates` (ou
 * `PromoRebateAccrued`), EXCLUINDO o sub-desconto de frete (que pertence à
 * linha de frete, não ao produto).
 *
 * Por quê: o bruto da venda deve ser o que o COMPRADOR pagou pelo produto.
 * DEALS já chegam líquidos em `ProductCharges` (comprovado em prod — payload
 * da oferta traz ProductCharges = preço da oferta, sem PromoRebates); CUPONS
 * vêm com `ProductCharges` cheio + `PromoRebates` negativo destacado. Sem esta
 * dedução, venda com cupom infla `valorBruto` vs Seller Central. Espelha a
 * regra do sync de Orders (`ItemPrice - PromotionDiscount`).
 */
export function extrairPromoRebatesProdutoDoItemCentavos(item: unknown): number {
  if (!isRecordFin(item)) return 0;
  const breakdowns = (item as { breakdowns?: unknown }).breakdowns;
  if (!Array.isArray(breakdowns)) return 0;

  let promoProduto = 0;
  for (const bd of breakdowns) {
    if (!isRecordFin(bd)) continue;
    const tipo = normalizarTipoBreakdown(bd.breakdownType);
    if (tipo !== "promorebates" && tipo !== "promorebateaccrued") continue;

    const total = Math.abs(amountCentavosFin(bd.breakdownAmount));
    const subs = Array.isArray(bd.breakdowns) ? bd.breakdowns : [];

    let descontoFrete = 0;
    for (const sub of subs) {
      if (!isRecordFin(sub)) continue;
      const subTipo = normalizarTipoBreakdown(sub.breakdownType);
      if (
        subTipo === "shippingdiscount" ||
        subTipo === "shippingpromotiondiscount" ||
        subTipo === "shippingpromotionaldiscount"
      ) {
        descontoFrete += Math.abs(amountCentavosFin(sub.breakdownAmount));
      }
    }

    promoProduto += Math.max(0, total - descontoFrete);
  }
  return promoProduto;
}

function normalizarTipoBreakdown(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z]/g, "")
    : "";
}

function amountCentavosFin(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100);
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/,/g, "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  if (!isRecordFin(raw)) return 0;
  const nested =
    raw.currencyAmount ?? raw.amount ?? raw.Amount ?? raw.value ?? raw.Value;
  if (nested == null || nested === raw) return 0;
  return amountCentavosFin(nested);
}

function isRecordFin(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
