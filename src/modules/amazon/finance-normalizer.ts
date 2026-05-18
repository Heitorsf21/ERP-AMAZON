import type { SPFinanceTransaction } from "@/lib/amazon-sp-api";

export type NormalizedFinanceItem = {
  sku: string | null;
  asin: string | null;
  title: string | null;
  quantity: number;
  totalAmountCentavos: number;
  productChargesCentavos: number;
  amazonFeesCentavos: number;
  promoRebatesCentavos: number;
  refundedSalesCentavos: number;
  orderItemId: string | null;
};

export type NormalizedFinanceTransaction = {
  raw: SPFinanceTransaction;
  transactionId: string | null;
  transactionType: string | null;
  transactionStatus: string | null;
  description: string | null;
  postedDate: Date | null;
  marketplaceId: string | null;
  amazonOrderId: string | null;
  refundId: string | null;
  settlementId: string | null;
  totalAmountCentavos: number | null;
  totalAmountCurrency: string | null;
  items: NormalizedFinanceItem[];
};

export type NormalizedAmazonRefund = {
  refundKey: string;
  refundId: string | null;
  amazonOrderId: string;
  sku: string;
  asin: string | null;
  titulo: string | null;
  quantidade: number;
  valorReembolsadoCentavos: number;
  taxasReembolsadasCentavos: number;
  dataReembolso: Date;
  liquidacaoId: string | null;
  marketplace: string | null;
  transactionStatus: string | null;
  sourceTransactionIds: string[];
  sourceStatuses: string[];
};

export function normalizeFinanceTransaction(
  input: unknown,
): NormalizedFinanceTransaction | null {
  const raw = parseFinancePayload(input);
  if (!isRecord(raw)) return null;

  const relatedIdentifiers = readArray(raw.relatedIdentifiers).filter(isRecord);
  const transactionId = readString(raw.transactionId);
  const transactionType = readString(raw.transactionType);
  const transactionStatus = readString(raw.transactionStatus);
  const postedDate = parseDate(readString(raw.postedDate));
  const totalAmount = parseMoney(raw.totalAmount);

  const items = getFinanceItems(raw).map((item) =>
    normalizeFinanceItem(item, raw),
  );

  return {
    raw: raw as SPFinanceTransaction,
    transactionId,
    transactionType,
    transactionStatus,
    description: readString(raw.description),
    postedDate,
    marketplaceId:
      readString(raw.marketplaceId) ??
      readString(readRecord(raw.marketplaceDetails)?.marketplaceId) ??
      readString(readRecord(raw.sellingPartnerMetadata)?.marketplaceId),
    amazonOrderId: findRelatedIdentifier(relatedIdentifiers, "ORDER_ID"),
    refundId: findRelatedIdentifier(relatedIdentifiers, "REFUND_ID"),
    settlementId: findRelatedIdentifier(relatedIdentifiers, "SETTLEMENT_ID"),
    totalAmountCentavos: totalAmount.centavos,
    totalAmountCurrency: totalAmount.currency,
    items,
  };
}

export function normalizeFinanceTransactions(
  inputs: unknown[],
): NormalizedFinanceTransaction[] {
  return inputs
    .map((input) => normalizeFinanceTransaction(input))
    .filter((tx): tx is NormalizedFinanceTransaction => tx != null);
}

export function extractAmazonRefunds(
  inputs: unknown[],
): NormalizedAmazonRefund[] {
  return dedupeAmazonRefunds(
    normalizeFinanceTransactions(inputs).flatMap((tx) => {
      if (!isRefundTransaction(tx)) return [];
      if (!tx.amazonOrderId) return [];
      const amazonOrderId = tx.amazonOrderId;

      const transactionId = tx.transactionId ?? tx.refundId;
      const sourceId = transactionId ? [transactionId] : [];
      return tx.items
        .map((item): NormalizedAmazonRefund | null => {
          if (!item.sku) return null;
          const valorReembolsadoCentavos =
            Math.abs(item.productChargesCentavos) ||
            Math.abs(item.refundedSalesCentavos) ||
            Math.abs(tx.totalAmountCentavos ?? 0);
          if (valorReembolsadoCentavos <= 0) return null;

          const refundKey =
            tx.refundId ??
            tx.transactionId ??
            `${amazonOrderId}:${item.sku}:${tx.postedDate?.toISOString() ?? "sem-data"}`;

          return {
            refundKey,
            refundId: tx.refundId,
            amazonOrderId,
            sku: item.sku,
            asin: item.asin,
            titulo: item.title,
            quantidade: item.quantity,
            valorReembolsadoCentavos,
            taxasReembolsadasCentavos: Math.abs(item.amazonFeesCentavos),
            dataReembolso: tx.postedDate ?? new Date(0),
            liquidacaoId: tx.settlementId,
            marketplace: tx.marketplaceId,
            transactionStatus: tx.transactionStatus,
            sourceTransactionIds: sourceId,
            sourceStatuses: tx.transactionStatus ? [tx.transactionStatus] : [],
          };
        })
        .filter((refund): refund is NormalizedAmazonRefund => refund != null);
    }),
  );
}

export function dedupeAmazonRefunds(
  refunds: NormalizedAmazonRefund[],
): NormalizedAmazonRefund[] {
  const map = new Map<string, NormalizedAmazonRefund>();
  for (const refund of refunds) {
    const key = `${refund.refundKey}\u0000${refund.amazonOrderId}\u0000${refund.sku}`;
    const existente = map.get(key);
    if (!existente) {
      map.set(key, {
        ...refund,
        sourceTransactionIds: [...new Set(refund.sourceTransactionIds)],
        sourceStatuses: [...new Set(refund.sourceStatuses)],
      });
      continue;
    }

    const preferred = isPreferredRefund(refund, existente) ? refund : existente;
    map.set(key, {
      ...preferred,
      valorReembolsadoCentavos: Math.max(
        existente.valorReembolsadoCentavos,
        refund.valorReembolsadoCentavos,
      ),
      taxasReembolsadasCentavos: Math.max(
        existente.taxasReembolsadasCentavos,
        refund.taxasReembolsadasCentavos,
      ),
      sourceTransactionIds: [
        ...new Set([
          ...existente.sourceTransactionIds,
          ...refund.sourceTransactionIds,
        ]),
      ],
      sourceStatuses: [
        ...new Set([...existente.sourceStatuses, ...refund.sourceStatuses]),
      ],
    });
  }
  return [...map.values()];
}

export function refundCobreVenda(
  refund: Pick<NormalizedAmazonRefund, "valorReembolsadoCentavos">,
  valorBrutoCentavos: number | null | undefined,
): boolean {
  const bruto = valorBrutoCentavos ?? 0;
  if (bruto <= 0) return false;
  const tolerancia = Math.max(100, Math.round(bruto * 0.05));
  return refund.valorReembolsadoCentavos >= bruto - tolerancia;
}

export function parseFinancePayload(input: unknown): unknown {
  let current = input;
  for (let i = 0; i < 3; i++) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed) return null;
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return current;
      try {
        current = JSON.parse(trimmed);
        continue;
      } catch {
        return current;
      }
    }

    if (isRecord(current) && typeof current.payload === "string") {
      current = current.payload;
      continue;
    }

    return current;
  }
  return current;
}

function normalizeFinanceItem(
  item: Record<string, unknown>,
  transaction: Record<string, unknown>,
): NormalizedFinanceItem {
  const contexts = readArray(item.contexts).filter(isRecord);
  const productContext =
    contexts.find((ctx) => readString(ctx.contextType) === "ProductContext") ??
    contexts.find((ctx) => readString(ctx.sku));
  const relatedIdentifiers = readArray(item.relatedIdentifiers).filter(isRecord);

  return {
    sku:
      readString(item.sku) ??
      readString(item.sellerSKU) ??
      readString(item.SKU) ??
      readString(productContext?.sku),
    asin: readString(item.asin) ?? readString(productContext?.asin),
    title:
      readString(item.title) ??
      readString(item.description) ??
      readString(item.itemName),
    quantity: Math.max(
      1,
      readNumber(item.quantity) ??
        readNumber(productContext?.quantityShipped) ??
        readNumber(productContext?.quantity) ??
        1,
    ),
    totalAmountCentavos: parseMoney(item.totalAmount).centavos ?? 0,
    productChargesCentavos: findTopBreakdownAmount(item, "ProductCharges"),
    amazonFeesCentavos: findTopBreakdownAmount(item, "AmazonFees"),
    promoRebatesCentavos: findTopBreakdownAmount(item, "PromoRebates"),
    refundedSalesCentavos:
      findTopBreakdownAmount(item, "Refunded Sales") ||
      findTopBreakdownAmount(transaction, "Refunded Sales"),
    orderItemId:
      readString(item.orderItemId) ??
      readString(item.OrderItemId) ??
      findItemRelatedIdentifier(relatedIdentifiers, "ORDER_ADJUSTMENT_ITEM_ID"),
  };
}

function getFinanceItems(
  transaction: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const items = readArray(transaction.items).filter(isRecord);
  if (items.length > 0) return items;
  const transactionItems = readArray(transaction.transactionItems).filter(isRecord);
  if (transactionItems.length > 0) return transactionItems;
  return [transaction];
}

function isRefundTransaction(tx: NormalizedFinanceTransaction): boolean {
  const kind = `${tx.transactionType ?? ""} ${tx.description ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return kind.includes("refund") || kind.includes("reembolso");
}

function isPreferredRefund(
  candidate: NormalizedAmazonRefund,
  current: NormalizedAmazonRefund,
): boolean {
  const rankCandidate = statusRank(candidate.transactionStatus);
  const rankCurrent = statusRank(current.transactionStatus);
  if (rankCandidate !== rankCurrent) return rankCandidate > rankCurrent;
  return candidate.dataReembolso.getTime() > current.dataReembolso.getTime();
}

function statusRank(status?: string | null): number {
  const normalized = (status ?? "").toUpperCase();
  if (normalized === "RELEASED") return 4;
  if (normalized === "DEFERRED_RELEASED") return 3;
  if (normalized === "DEFERRED") return 2;
  return 1;
}

function findRelatedIdentifier(
  identifiers: Record<string, unknown>[],
  name: string,
): string | null {
  const found = identifiers.find(
    (identifier) =>
      readString(identifier.relatedIdentifierName)?.toUpperCase() === name,
  );
  return readString(found?.relatedIdentifierValue);
}

function findItemRelatedIdentifier(
  identifiers: Record<string, unknown>[],
  name: string,
): string | null {
  const found = identifiers.find(
    (identifier) =>
      readString(identifier.itemRelatedIdentifierName)?.toUpperCase() === name,
  );
  return readString(found?.itemRelatedIdentifierValue);
}

function findTopBreakdownAmount(
  value: unknown,
  breakdownType: string,
): number {
  if (!isRecord(value)) return 0;
  const breakdowns = readArray(value.breakdowns).filter(isRecord);
  const found = breakdowns.find(
    (breakdown) => readString(breakdown.breakdownType) === breakdownType,
  );
  return parseMoney(found?.breakdownAmount).centavos ?? 0;
}

function parseMoney(raw: unknown): { centavos: number | null; currency: string | null } {
  if (raw == null) return { centavos: null, currency: null };
  if (typeof raw === "number") {
    return {
      centavos: Number.isFinite(raw) ? Math.round(raw * 100) : null,
      currency: null,
    };
  }
  if (typeof raw === "string") {
    const parsed = parseDecimal(raw);
    return {
      centavos: parsed == null ? null : Math.round(parsed * 100),
      currency: null,
    };
  }
  if (!isRecord(raw)) return { centavos: null, currency: null };
  const value =
    raw.currencyAmount ??
    raw.amount ??
    raw.Amount ??
    raw.value ??
    raw.Value ??
    raw.totalAmount ??
    raw.breakdownAmount;
  const nested = value === raw ? null : parseMoney(value);
  return {
    centavos: nested?.centavos ?? null,
    currency:
      readString(raw.currencyCode) ??
      readString(raw.CurrencyCode) ??
      readString(raw.currency) ??
      nested?.currency ??
      null,
  };
}

function parseDecimal(value: string): number | null {
  const normalized =
    value.includes(",") && !value.includes(".")
      ? value.replace(".", "").replace(",", ".")
      : value.replace(/,/g, "");
  const parsed = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseDecimal(value);
    return parsed == null ? null : parsed;
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
