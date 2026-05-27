import { describe, expect, it } from "vitest";
import {
  agregarBreakdownDeTransacoes,
  extrairBreakdownDeTransacao,
} from "./breakdown-parser";

/**
 * Helper para construir transactions Finance sintéticas com a estrutura
 * que a SP-API retorna (breakdowns aninhados). Valores em reais decimal,
 * convertidos para centavos pelo parser.
 */
function shipmentTx(opts: {
  sku?: string;
  orderItemId?: string;
  productCharges?: number;
  amazonFeesAggregate?: number;
  commission?: number;
  fbaFee?: number;
  fbaFeeType?: string;
  parcelamento?: number;
  closingFee?: number;
  promoRebates?: number;
  shippingDiscount?: number;
  shippingCharge?: number;
  shippingChargeback?: number;
}): { payload: string; transactionType: string | null } {
  const subBreakdowns: unknown[] = [];
  if (opts.commission != null) {
    subBreakdowns.push({
      breakdownType: "Commission",
      breakdownAmount: { currencyAmount: opts.commission, currencyCode: "BRL" },
    });
  }
  if (opts.fbaFee != null) {
    subBreakdowns.push({
      breakdownType: opts.fbaFeeType ?? "FBAFulfillmentFee",
      breakdownAmount: { currencyAmount: opts.fbaFee },
    });
  }
  if (opts.parcelamento != null) {
    subBreakdowns.push({
      breakdownType: "AmazonForAllFee",
      breakdownAmount: { currencyAmount: opts.parcelamento },
    });
  }
  if (opts.closingFee != null) {
    subBreakdowns.push({
      breakdownType: "ClosingFee",
      breakdownAmount: { currencyAmount: opts.closingFee },
    });
  }

  const topBreakdowns: unknown[] = [];
  if (opts.productCharges != null) {
    topBreakdowns.push({
      breakdownType: "ProductCharges",
      breakdownAmount: { currencyAmount: opts.productCharges },
    });
  }
  if (
    opts.amazonFeesAggregate != null ||
    opts.commission != null ||
    opts.fbaFee != null ||
    opts.parcelamento != null ||
    opts.closingFee != null
  ) {
    topBreakdowns.push({
      breakdownType: "AmazonFees",
      breakdownAmount: { currencyAmount: opts.amazonFeesAggregate ?? 0 },
      breakdowns: subBreakdowns,
    });
  }
  if (opts.promoRebates != null || opts.shippingDiscount != null) {
    topBreakdowns.push({
      breakdownType: "PromoRebates",
      breakdownAmount: {
        currencyAmount: opts.promoRebates ?? opts.shippingDiscount,
      },
      ...(opts.shippingDiscount != null
        ? {
            breakdowns: [
              {
                breakdownType: "ShippingDiscount",
                breakdownAmount: { currencyAmount: opts.shippingDiscount },
              },
            ],
          }
        : {}),
    });
  }
  if (opts.shippingCharge != null) {
    topBreakdowns.push({
      breakdownType: "ShippingCharge",
      breakdownAmount: { currencyAmount: opts.shippingCharge },
    });
  }
  if (opts.shippingChargeback != null) {
    topBreakdowns.push({
      breakdownType: "ShippingChargeback",
      breakdownAmount: { currencyAmount: opts.shippingChargeback },
    });
  }

  const payload = JSON.stringify({
    transactionType: "Shipment",
    items: [
      {
        sku: opts.sku ?? "MFS-0036",
        orderItemId: opts.orderItemId,
        breakdowns: topBreakdowns,
      },
    ],
  });
  return { payload, transactionType: "Shipment" };
}

describe("breakdown-parser · extrairBreakdownDeTransacao", () => {
  it("extrai sub-breakdown aninhado de AmazonFees (Commission + FBA + parcelamento + closing)", () => {
    const tx = shipmentTx({
      sku: "MFS-0036",
      productCharges: 79.99,
      amazonFeesAggregate: -15.8,
      commission: -9.6,
      fbaFee: -5.0,
      parcelamento: -1.2,
      closingFee: -0,
      shippingCharge: 4.1,
      shippingChargeback: -4.1,
    });

    const r = extrairBreakdownDeTransacao(tx.payload, "MFS-0036");

    expect(r.encontrado).toBe(true);
    expect(r.productChargesCentavos).toBe(7999);
    expect(r.comissaoCentavos).toBe(960);
    expect(r.taxaFbaCentavos).toBe(500);
    expect(r.taxaParcelamentoCentavos).toBe(120);
    expect(r.closingFeeCentavos).toBe(0);
    expect(r.freteRecebidoCentavos).toBe(410);
    expect(r.fretePagoCentavos).toBe(410);
    expect(r.promoRebatesCentavos).toBe(0);
    expect(r.descontoFreteCentavos).toBe(0);
  });

  it("preserva o agregado quando AmazonFees não traz sub-breakdowns", () => {
    const payload = JSON.stringify({
      transactionType: "Shipment",
      items: [
        {
          sku: "SEM-SUB",
          breakdowns: [
            {
              breakdownType: "AmazonFees",
              breakdownAmount: { currencyAmount: -12.34 },
              // sem `breakdowns` interno
            },
          ],
        },
      ],
    });

    const r = extrairBreakdownDeTransacao(payload, "SEM-SUB");
    expect(r.encontrado).toBe(true);
    expect(r.comissaoCentavos).toBe(0);
    expect(r.taxasAmazonNaoDetalhadasCentavos).toBe(1234);
    expect(r.taxaFbaCentavos).toBe(0);
    expect(r.taxaParcelamentoCentavos).toBe(0);
  });

  it("reconhece variantes reais de taxa FBA sem jogar em comissao", () => {
    for (const fbaFeeType of [
      "FBAPerUnitFulfillmentFee",
      "FBAFees",
      "FulfillmentFees",
    ]) {
      const tx = shipmentTx({
        sku: fbaFeeType,
        commission: -5.28,
        fbaFee: -5,
        fbaFeeType,
      });
      const r = extrairBreakdownDeTransacao(tx.payload, fbaFeeType);

      expect(r.comissaoCentavos).toBe(528);
      expect(r.taxaFbaCentavos).toBe(500);
      expect(r.taxasAmazonNaoDetalhadasCentavos).toBe(0);
    }
  });

  it("captura PromoRebates como custo positivo (desconto do seller)", () => {
    const tx = shipmentTx({
      sku: "MFS-PROMO",
      promoRebates: -2.0,
      commission: -1.0,
    });
    const r = extrairBreakdownDeTransacao(tx.payload, "MFS-PROMO");
    expect(r.promoRebatesCentavos).toBe(200);
    expect(r.descontoFreteCentavos).toBe(0);
    expect(r.comissaoCentavos).toBe(100);
  });

  it("separa ShippingDiscount de PromoRebates como desconto de frete", () => {
    const tx = shipmentTx({
      sku: "MFS-FRETE",
      shippingCharge: 8.9,
      shippingDiscount: -8.9,
      commission: -4,
    });

    const r = extrairBreakdownDeTransacao(tx.payload, "MFS-FRETE");

    expect(r.freteRecebidoCentavos).toBe(890);
    expect(r.descontoFreteCentavos).toBe(890);
    expect(r.promoRebatesCentavos).toBe(0);
    expect(r.comissaoCentavos).toBe(400);
  });

  it("retorna zeros e encontrado=false quando o SKU não bate em nenhum item", () => {
    const tx = shipmentTx({ sku: "OUTRO-SKU", commission: -5 });
    const r = extrairBreakdownDeTransacao(tx.payload, "NAO-EXISTE");
    expect(r.encontrado).toBe(false);
    expect(r.comissaoCentavos).toBe(0);
  });

  it("prefere casamento por orderItemId quando informado", () => {
    const payload = JSON.stringify({
      transactionType: "Shipment",
      items: [
        {
          sku: "DUP",
          orderItemId: "OII-1",
          breakdowns: [{ breakdownType: "AmazonFees", breakdownAmount: { currencyAmount: -3 } }],
        },
        {
          sku: "DUP",
          orderItemId: "OII-2",
          breakdowns: [{ breakdownType: "AmazonFees", breakdownAmount: { currencyAmount: -7 } }],
        },
      ],
    });

    const r = extrairBreakdownDeTransacao(payload, "DUP", "OII-2");
    expect(r.comissaoCentavos).toBe(0);
    expect(r.taxasAmazonNaoDetalhadasCentavos).toBe(700);
  });

  it("trata payload em string aninhada (parseFinancePayload reuso)", () => {
    const inner = JSON.stringify({
      transactionType: "Shipment",
      items: [
        {
          sku: "WRAPPED",
          breakdowns: [{ breakdownType: "AmazonFees", breakdownAmount: -4 }],
        },
      ],
    });
    const wrapped = JSON.stringify({ payload: inner });
    const r = extrairBreakdownDeTransacao(wrapped, "WRAPPED");
    expect(r.encontrado).toBe(true);
    expect(r.comissaoCentavos).toBe(0);
    expect(r.taxasAmazonNaoDetalhadasCentavos).toBe(400);
  });
});

describe("breakdown-parser · agregarBreakdownDeTransacoes", () => {
  it("soma sub-fees de múltiplas Shipment transactions do mesmo orderId+sku", () => {
    const t1 = shipmentTx({ sku: "MFS-MULT", commission: -3, fbaFee: -2 });
    const t2 = shipmentTx({ sku: "MFS-MULT", commission: -1, fbaFee: -1.5 });
    const r = agregarBreakdownDeTransacoes([t1, t2], "MFS-MULT");
    expect(r.encontrado).toBe(true);
    expect(r.comissaoCentavos).toBe(400);
    expect(r.taxaFbaCentavos).toBe(350);
  });

  it("ignora Refund e Adjustment (apenas Shipment conta para o breakdown da venda)", () => {
    const refund = {
      payload: JSON.stringify({
        transactionType: "Refund",
        items: [
          {
            sku: "MFS-IGN",
            breakdowns: [{ breakdownType: "AmazonFees", breakdownAmount: -10 }],
          },
        ],
      }),
      transactionType: "Refund",
    };
    const adjustment = {
      payload: JSON.stringify({
        transactionType: "Adjustment",
        items: [
          {
            sku: "MFS-IGN",
            breakdowns: [{ breakdownType: "AmazonFees", breakdownAmount: -10 }],
          },
        ],
      }),
      transactionType: "Adjustment",
    };

    const r = agregarBreakdownDeTransacoes([refund, adjustment], "MFS-IGN");
    expect(r.encontrado).toBe(false);
    expect(r.comissaoCentavos).toBe(0);
  });

  it("retorna zerado para lista vazia", () => {
    const r = agregarBreakdownDeTransacoes([], "QQR");
    expect(r.encontrado).toBe(false);
    expect(r.comissaoCentavos).toBe(0);
    expect(r.taxaFbaCentavos).toBe(0);
  });

  it("aceita variantes de tipo (ShipmentItem, case-insensitive, com espaços)", () => {
    const t1 = shipmentTx({ sku: "MFS-VAR", commission: -2 });
    t1.transactionType = "shipment-item";
    const t2 = shipmentTx({ sku: "MFS-VAR", commission: -3 });
    t2.transactionType = "SHIPMENT";
    const r = agregarBreakdownDeTransacoes([t1, t2], "MFS-VAR");
    expect(r.encontrado).toBe(true);
    expect(r.comissaoCentavos).toBe(500);
  });
});
