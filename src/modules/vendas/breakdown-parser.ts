/**
 * Parser isolado para extrair sub-breakdown financeiro a partir do payload
 * cru de `AmazonFinanceTransaction.payload` (JSON da SP-API Finance).
 *
 * Por que existe:
 *   O [finance-normalizer](src/modules/amazon/finance-normalizer.ts) só
 *   normaliza breakdowns top-level (AmazonFees, ProductCharges, PromoRebates,
 *   Shipping*). Para a tela de Vendas precisamos do sub-breakdown ANINHADO
 *   dentro de AmazonFees: Commission, FBA, AmazonForAllFee (parcelamento) e
 *   ClosingFee.
 *
 *   Em vez de importar helpers privados de service.ts ou expandir o
 *   normalizer (que tem testes próprios), criamos um parser dedicado com
 *   testes independentes.
 *
 *   Tudo aqui é puro (sem I/O, sem efeitos). Recebe payload já parseado
 *   (via `parseFinancePayload` do normalizer) e devolve números em centavos
 *   sempre positivos, com sinal codificado na semântica do nome do campo.
 */
import { parseFinancePayload } from "@/modules/amazon/finance-normalizer";

export type ParsedFinanceBreakdown = {
  /** Valor recebido por venda (ProductCharges positivo). */
  productChargesCentavos: number;
  /** Comissão (referral fee) descontada pela Amazon. Sempre positivo. */
  comissaoCentavos: number;
  /** Taxa de fulfillment FBA descontada. Sempre positivo. */
  taxaFbaCentavos: number;
  /** AmazonForAllFee (parcelamento 1.5%) descontada. Sempre positivo. */
  taxaParcelamentoCentavos: number;
  /** Closing fee de mídia (Livros/DVD/Música). Sempre positivo. */
  closingFeeCentavos: number;
  /** AmazonFees sem sub-breakdown classificavel. Sempre positivo. */
  taxasAmazonNaoDetalhadasCentavos: number;
  /** Desconto de oferta dado pelo seller (PromoRebates). Sempre positivo. */
  promoRebatesCentavos: number;
  /** Valor de frete repassado pela Amazon ao seller (ShippingCharge). */
  freteRecebidoCentavos: number;
  /** Valor de frete descontado pela Amazon (ShippingChargeback). */
  fretePagoCentavos: number;
  /** True quando o item foi encontrado dentro de alguma transação. */
  encontrado: boolean;
};

const EMPTY: ParsedFinanceBreakdown = {
  productChargesCentavos: 0,
  comissaoCentavos: 0,
  taxaFbaCentavos: 0,
  taxaParcelamentoCentavos: 0,
  closingFeeCentavos: 0,
  taxasAmazonNaoDetalhadasCentavos: 0,
  promoRebatesCentavos: 0,
  freteRecebidoCentavos: 0,
  fretePagoCentavos: 0,
  encontrado: false,
};

// Tipos de transação que devem ser consideradas para o breakdown de uma
// VENDA (Shipment). Refund/Adjustment vivem em outros agregados.
const TRANSACTION_TYPES_SHIPMENT = new Set([
  "shipment",
  "shipmentitem",
]);

/**
 * Extrai o breakdown agregado a partir de uma ou mais transactions da mesma
 * VendaAmazon (mesmo amazonOrderId + sku). Apenas transações tipo
 * "Shipment" são consideradas — refunds/adjustments são ignorados (vivem
 * em outras telas/agregados).
 *
 * Se `orderItemId` for fornecido, casa preferencialmente por ele; caso
 * contrário, casa pelo SKU.
 */
export function agregarBreakdownDeTransacoes(
  transactions: Array<{ payload: unknown; transactionType: string | null }>,
  sku: string,
  orderItemId?: string | null,
): ParsedFinanceBreakdown {
  let resultado = { ...EMPTY };

  for (const tx of transactions) {
    if (!isShipmentTransaction(tx.transactionType)) continue;
    const parsed = parseFinancePayload(tx.payload);
    const item = encontrarItemDoSku(parsed, sku, orderItemId);
    if (!item) continue;

    const extraido = extrairDoItem(item);
    resultado = somar(resultado, extraido);
    resultado.encontrado = true;
  }

  return resultado;
}

/** Versão helper para uma única transação. Usada nos testes. */
export function extrairBreakdownDeTransacao(
  payload: unknown,
  sku: string,
  orderItemId?: string | null,
): ParsedFinanceBreakdown {
  const parsed = parseFinancePayload(payload);
  const item = encontrarItemDoSku(parsed, sku, orderItemId);
  if (!item) return { ...EMPTY };
  return { ...extrairDoItem(item), encontrado: true };
}

function isShipmentTransaction(type: string | null | undefined): boolean {
  if (!type) return false;
  const normalized = type.toLowerCase().replace(/[^a-z]/g, "");
  return TRANSACTION_TYPES_SHIPMENT.has(normalized);
}

/**
 * Busca o item dentro do payload que corresponde ao SKU. Quando
 * `orderItemId` é informado, prefere o match exato; senão usa o primeiro
 * com o mesmo SKU.
 */
function encontrarItemDoSku(
  parsed: unknown,
  sku: string,
  orderItemId?: string | null,
): Record<string, unknown> | null {
  if (!isRecord(parsed)) return null;

  const items = coletarItems(parsed);
  if (items.length === 0) return null;

  if (orderItemId) {
    const byOrderItem = items.find((item) => extractOrderItemId(item) === orderItemId);
    if (byOrderItem) return byOrderItem;
  }

  const skuLower = sku.toLowerCase();
  const bySku = items.find((item) => {
    const itemSku = extractSku(item);
    return itemSku != null && itemSku.toLowerCase() === skuLower;
  });
  return bySku ?? null;
}

function coletarItems(
  transaction: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const items = readArray(transaction.items).filter(isRecord);
  if (items.length > 0) return items;
  const transactionItems = readArray(transaction.transactionItems).filter(isRecord);
  if (transactionItems.length > 0) return transactionItems;
  return [];
}

function extractSku(item: Record<string, unknown>): string | null {
  const direct =
    readString(item.sku) ??
    readString(item.sellerSKU) ??
    readString(item.SKU);
  if (direct) return direct;
  const contexts = readArray(item.contexts).filter(isRecord);
  for (const ctx of contexts) {
    const fromCtx = readString(ctx.sku) ?? readString(ctx.sellerSKU);
    if (fromCtx) return fromCtx;
  }
  return null;
}

function extractOrderItemId(item: Record<string, unknown>): string | null {
  const direct =
    readString(item.orderItemId) ??
    readString(item.OrderItemId);
  if (direct) return direct;
  const relateds = readArray(item.relatedIdentifiers).filter(isRecord);
  for (const r of relateds) {
    const name =
      readString(r.itemRelatedIdentifierName) ??
      readString(r.relatedIdentifierName);
    if (name?.toUpperCase() === "ORDER_ADJUSTMENT_ITEM_ID") {
      const value =
        readString(r.itemRelatedIdentifierValue) ??
        readString(r.relatedIdentifierValue);
      if (value) return value;
    }
  }
  return null;
}

/**
 * Extrai e soma os sub-breakdowns relevantes do item.
 *
 * Estrutura típica (Finance API V0/V2024):
 *   item.breakdowns: [
 *     { breakdownType: "ProductCharges", breakdownAmount: { currencyAmount: 79.99 } },
 *     { breakdownType: "AmazonFees", breakdownAmount: { currencyAmount: -14.60 },
 *       breakdowns: [
 *         { breakdownType: "Commission",        breakdownAmount: -9.60 },
 *         { breakdownType: "FBAFulfillmentFee", breakdownAmount: -5.00 },
 *         { breakdownType: "AmazonForAllFee",   breakdownAmount: -1.20 },
 *         { breakdownType: "ClosingFee",        breakdownAmount: -0.50 },
 *       ]},
 *     { breakdownType: "PromoRebates",      breakdownAmount: -2.00 },
 *     { breakdownType: "ShippingCharge",    breakdownAmount: 4.10 },
 *     { breakdownType: "ShippingChargeback", breakdownAmount: -4.10 },
 *   ]
 */
function extrairDoItem(item: Record<string, unknown>): ParsedFinanceBreakdown {
  const result = { ...EMPTY, encontrado: true };

  const top = readArray(item.breakdowns).filter(isRecord);
  for (const bd of top) {
    const type = readString(bd.breakdownType);
    if (!type) continue;
    const valor = Math.abs(parseAmountCentavos(bd.breakdownAmount));

    switch (type) {
      case "ProductCharges":
        result.productChargesCentavos += valor;
        break;
      case "PromoRebates":
      case "PromoRebateAccrued":
        result.promoRebatesCentavos += valor;
        break;
      case "ShippingCharge":
      case "Shipping":
        result.freteRecebidoCentavos += valor;
        break;
      case "ShippingChargeback":
        result.fretePagoCentavos += valor;
        break;
      case "AmazonFees": {
        const subs = readArray(bd.breakdowns).filter(isRecord);
        if (subs.length === 0) {
          // Sem sub-breakdown: preserva o total sem inventar comissao/FBA.
          result.taxasAmazonNaoDetalhadasCentavos += valor;
          break;
        }
        for (const sub of subs) {
          const subType = readString(sub.breakdownType);
          if (!subType) continue;
          const subValor = Math.abs(parseAmountCentavos(sub.breakdownAmount));
          if (matchesCommission(subType)) {
            result.comissaoCentavos += subValor;
          } else if (matchesFba(subType)) {
            result.taxaFbaCentavos += subValor;
          } else if (matchesParcelamento(subType)) {
            result.taxaParcelamentoCentavos += subValor;
          } else if (matchesClosingFee(subType)) {
            result.closingFeeCentavos += subValor;
          } else {
            result.taxasAmazonNaoDetalhadasCentavos += subValor;
          }
        }
        break;
      }
      default:
        // Tipos desconhecidos no top-level são ignorados deliberadamente —
        // o lucro continua coerente com taxasCentavos agregado do Prisma.
        break;
    }
  }

  return result;
}

function matchesCommission(type: string): boolean {
  const t = type.toLowerCase();
  return t === "commission" || t === "referralfee" || t === "referral fee";
}

function matchesFba(type: string): boolean {
  const t = type.toLowerCase().replace(/[^a-z]/g, "");
  return (
    t === "fbafulfillmentfee" ||
    t === "fbafulfillmentfees" ||
    t === "fbafee" ||
    t === "fbafees" ||
    t === "fulfillmentfee" ||
    t === "fulfillmentfees" ||
    t === "fbatransactionfee" ||
    t === "fbaperunitfulfillmentfee" ||
    t === "fbaperorderfulfillmentfee" ||
    t === "fbamultitierperunitfee" ||
    t.startsWith("fbafulfill") ||
    (t.startsWith("fba") && (t.endsWith("fee") || t.endsWith("fees")))
  );
}

function matchesParcelamento(type: string): boolean {
  const t = type.toLowerCase().replace(/[^a-z]/g, "");
  return t === "amazonforallfee" || t === "installmentfee";
}

function matchesClosingFee(type: string): boolean {
  const t = type.toLowerCase().replace(/[^a-z]/g, "");
  return (
    t === "closingfee" ||
    t === "variableclosingfee" ||
    t === "fixedclosingfee"
  );
}

function somar(
  a: ParsedFinanceBreakdown,
  b: ParsedFinanceBreakdown,
): ParsedFinanceBreakdown {
  return {
    productChargesCentavos: a.productChargesCentavos + b.productChargesCentavos,
    comissaoCentavos: a.comissaoCentavos + b.comissaoCentavos,
    taxaFbaCentavos: a.taxaFbaCentavos + b.taxaFbaCentavos,
    taxaParcelamentoCentavos:
      a.taxaParcelamentoCentavos + b.taxaParcelamentoCentavos,
    closingFeeCentavos: a.closingFeeCentavos + b.closingFeeCentavos,
    taxasAmazonNaoDetalhadasCentavos:
      a.taxasAmazonNaoDetalhadasCentavos +
      b.taxasAmazonNaoDetalhadasCentavos,
    promoRebatesCentavos: a.promoRebatesCentavos + b.promoRebatesCentavos,
    freteRecebidoCentavos: a.freteRecebidoCentavos + b.freteRecebidoCentavos,
    fretePagoCentavos: a.fretePagoCentavos + b.fretePagoCentavos,
    encontrado: a.encontrado || b.encontrado,
  };
}

function parseAmountCentavos(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw * 100);
  }
  if (typeof raw === "string") {
    const decimal = parseDecimal(raw);
    return decimal == null ? 0 : Math.round(decimal * 100);
  }
  if (!isRecord(raw)) return 0;
  const nested =
    raw.currencyAmount ??
    raw.amount ??
    raw.Amount ??
    raw.value ??
    raw.Value;
  if (nested == null || nested === raw) return 0;
  return parseAmountCentavos(nested);
}

function parseDecimal(value: string): number | null {
  const normalized =
    value.includes(",") && !value.includes(".")
      ? value.replace(".", "").replace(",", ".")
      : value.replace(/,/g, "");
  const parsed = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
