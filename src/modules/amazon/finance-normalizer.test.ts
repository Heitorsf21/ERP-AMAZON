import { describe, expect, it } from "vitest";
import {
  extractAmazonRefunds,
  normalizeFinanceTransaction,
  refundCobreVenda,
} from "./finance-normalizer";

const refundPayload = {
  transactionType: "Refund",
  transactionId: "tx-release",
  transactionStatus: "RELEASED",
  relatedIdentifiers: [
    {
      relatedIdentifierName: "REFUND_ID",
      relatedIdentifierValue: "amzn1:crow:refund-1",
    },
    {
      relatedIdentifierName: "SETTLEMENT_ID",
      relatedIdentifierValue: "26262885491",
    },
    {
      relatedIdentifierName: "ORDER_ID",
      relatedIdentifierValue: "702-0080023-7388211",
    },
  ],
  totalAmount: { currencyAmount: -31.94, currencyCode: "BRL" },
  postedDate: "2026-04-18T23:21:56Z",
  marketplaceDetails: {
    marketplaceId: "A2Q3Y263D00KWC",
    marketplaceName: "Amazon.com.br",
  },
  items: [
    {
      description: "Bolsa Organizadora Cinza",
      totalAmount: { currencyAmount: -31.94, currencyCode: "BRL" },
      relatedIdentifiers: [
        {
          itemRelatedIdentifierName: "ORDER_ADJUSTMENT_ITEM_ID",
          itemRelatedIdentifierValue: "157232739052321",
        },
      ],
      breakdowns: [
        {
          breakdownType: "PromoRebates",
          breakdownAmount: { currencyAmount: 4, currencyCode: "BRL" },
        },
        {
          breakdownType: "ProductCharges",
          breakdownAmount: { currencyAmount: -39.97, currencyCode: "BRL" },
        },
        {
          breakdownType: "AmazonFees",
          breakdownAmount: { currencyAmount: 4.03, currencyCode: "BRL" },
        },
      ],
      contexts: [
        {
          asin: "B0FTK1LN75",
          quantityShipped: 1,
          sku: "MFS-0023+C",
          fulfillmentNetwork: "AFN",
          contextType: "ProductContext",
        },
      ],
    },
  ],
  breakdowns: [
    {
      breakdownType: "Refunded Sales",
      breakdownAmount: { currencyAmount: -39.97, currencyCode: "BRL" },
    },
  ],
};

describe("finance-normalizer", () => {
  it("extrai ORDER_ID, SKU e valores de refund da Transactions API v2024", () => {
    const tx = normalizeFinanceTransaction(refundPayload);

    expect(tx).toMatchObject({
      transactionId: "tx-release",
      transactionType: "Refund",
      transactionStatus: "RELEASED",
      amazonOrderId: "702-0080023-7388211",
      refundId: "amzn1:crow:refund-1",
      settlementId: "26262885491",
      marketplaceId: "A2Q3Y263D00KWC",
      totalAmountCentavos: -3194,
    });
    expect(tx?.items[0]).toMatchObject({
      sku: "MFS-0023+C",
      asin: "B0FTK1LN75",
      productChargesCentavos: -3997,
      amazonFeesCentavos: 403,
      promoRebatesCentavos: 400,
    });
  });

  it("parseia payload stringificado salvo em AmazonFinanceTransaction", () => {
    const tx = normalizeFinanceTransaction({
      payload: JSON.stringify(refundPayload),
    });

    expect(tx?.amazonOrderId).toBe("702-0080023-7388211");
    expect(tx?.items[0]?.sku).toBe("MFS-0023+C");
  });

  it("deduplica DEFERRED e RELEASED pelo mesmo REFUND_ID", () => {
    const deferred = {
      ...refundPayload,
      transactionId: "tx-deferred",
      transactionStatus: "DEFERRED",
      postedDate: "2026-04-17T23:21:56Z",
    };

    const refunds = extractAmazonRefunds([deferred, refundPayload]);

    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      refundKey: "amzn1:crow:refund-1",
      transactionStatus: "RELEASED",
      valorReembolsadoCentavos: 3997,
      taxasReembolsadasCentavos: 403,
      sourceTransactionIds: expect.arrayContaining(["tx-deferred", "tx-release"]),
    });
  });

  it("diferencia refund total de refund parcial", () => {
    const [refund] = extractAmazonRefunds([refundPayload]);

    expect(refundCobreVenda(refund!, 3997)).toBe(true);
    expect(refundCobreVenda({ valorReembolsadoCentavos: 297 }, 3184)).toBe(
      false,
    );
  });
});
