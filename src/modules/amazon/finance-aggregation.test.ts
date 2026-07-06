import { describe, expect, it } from "vitest";
import {
  agruparValoresFinanceirosVendaAmazon,
  extrairPromoRebatesProdutoDoItemCentavos,
  reconciliarFinanceiroParaBrutoCheio,
} from "./finance-aggregation";

describe("agruparValoresFinanceirosVendaAmazon", () => {
  it("soma partes financeiras do mesmo pedido e SKU antes de gravar", () => {
    const linhas = agruparValoresFinanceirosVendaAmazon([
      {
        amazonOrderId: "701-8920528-0677816",
        sku: "MFS-0034",
        valorBrutoCentavos: 3499,
        taxasCentavos: 1340,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 2159,
        liquidacaoId: "26393500511",
        statusFinanceiro: "DEFERRED",
      },
      {
        amazonOrderId: "701-8920528-0677816",
        sku: "MFS-0034",
        valorBrutoCentavos: 3499,
        taxasCentavos: 500,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 2999,
        liquidacaoId: "26393500511",
        statusFinanceiro: "DEFERRED",
      },
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      amazonOrderId: "701-8920528-0677816",
      sku: "MFS-0034",
      valorBrutoCentavos: 6998,
      taxasCentavos: 1840,
      fretesCentavos: 0,
      liquidoMarketplaceCentavos: 5158,
      liquidacaoId: "26393500511",
      statusFinanceiro: "DEFERRED",
    });
  });

  it("mantem SKUs diferentes separados dentro do mesmo pedido", () => {
    const linhas = agruparValoresFinanceirosVendaAmazon([
      {
        amazonOrderId: "701-1",
        sku: "SKU-A",
        valorBrutoCentavos: 3000,
        taxasCentavos: 300,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 2700,
      },
      {
        amazonOrderId: "701-1",
        sku: "SKU-B",
        valorBrutoCentavos: 7000,
        taxasCentavos: 700,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 6300,
      },
    ]);

    expect(linhas).toHaveLength(2);
    expect(linhas.reduce((sum, linha) => sum + linha.taxasCentavos, 0)).toBe(
      1000,
    );
  });
});

describe("reconciliarFinanceiroParaBrutoCheio", () => {
  it("escala taxa/liquido de um evento de 1 unidade para o bruto cheio do pedido", () => {
    // Pedido qty=2: bruto cheio 17978 (do Orders), mas o evento Finance trouxe
    // taxa de 1 unidade (1714) sobre ProductCharges de 1 unidade (8989).
    const r = reconciliarFinanceiroParaBrutoCheio({
      brutoCheioCentavos: 17978,
      taxasCentavos: 1714,
      baseBrutoCentavos: 8989,
    });
    expect(r.taxasCentavos).toBe(3428);
    expect(r.liquidoMarketplaceCentavos).toBe(14550);
    expect(r.taxasCentavos + r.liquidoMarketplaceCentavos).toBe(17978);
  });

  it("nao altera quando o evento ja cobre o bruto cheio", () => {
    const r = reconciliarFinanceiroParaBrutoCheio({
      brutoCheioCentavos: 17994,
      taxasCentavos: 3430,
      baseBrutoCentavos: 17994,
    });
    expect(r.taxasCentavos).toBe(3430);
    expect(r.liquidoMarketplaceCentavos).toBe(14564);
  });

  it("sem base de taxa (ProductCharges 0): mantem taxas e garante o invariante", () => {
    const r = reconciliarFinanceiroParaBrutoCheio({
      brutoCheioCentavos: 10000,
      taxasCentavos: 1500,
      baseBrutoCentavos: 0,
    });
    expect(r.taxasCentavos).toBe(1500);
    expect(r.liquidoMarketplaceCentavos).toBe(8500);
  });

  it("bruto cheio zero => zera", () => {
    const r = reconciliarFinanceiroParaBrutoCheio({
      brutoCheioCentavos: 0,
      taxasCentavos: 1714,
      baseBrutoCentavos: 8989,
    });
    expect(r.taxasCentavos).toBe(0);
    expect(r.liquidoMarketplaceCentavos).toBe(0);
  });

  it("re-escala o frete do evento pelo mesmo fator das taxas (multi-unidade)", () => {
    const r = reconciliarFinanceiroParaBrutoCheio({
      brutoCheioCentavos: 17978,
      taxasCentavos: 1714,
      baseBrutoCentavos: 8989,
      fretesCentavos: 410,
    });
    expect(r.fretesCentavos).toBe(820);
  });

  it("frete ausente vira 0 sem afetar taxas/liquido", () => {
    const r = reconciliarFinanceiroParaBrutoCheio({
      brutoCheioCentavos: 17994,
      taxasCentavos: 3430,
      baseBrutoCentavos: 17994,
    });
    expect(r.fretesCentavos).toBe(0);
    expect(r.taxasCentavos + r.liquidoMarketplaceCentavos).toBe(17994);
  });
});

describe("extrairPromoRebatesProdutoDoItemCentavos", () => {
  const itemComBreakdowns = (breakdowns: unknown[]) => ({ breakdowns });

  it("deal sem PromoRebates (ProductCharges ja liquido): desconto 0", () => {
    const item = itemComBreakdowns([
      {
        breakdownType: "ProductCharges",
        breakdownAmount: { currencyAmount: 67.97 },
      },
      { breakdownType: "AmazonFees", breakdownAmount: { currencyAmount: -14.18 } },
    ]);
    expect(extrairPromoRebatesProdutoDoItemCentavos(item)).toBe(0);
  });

  it("cupom: PromoRebates destacado vira desconto de produto", () => {
    const item = itemComBreakdowns([
      {
        breakdownType: "ProductCharges",
        breakdownAmount: { currencyAmount: 79.99 },
      },
      {
        breakdownType: "PromoRebates",
        breakdownAmount: { currencyAmount: -8.0 },
        breakdowns: [],
      },
    ]);
    expect(extrairPromoRebatesProdutoDoItemCentavos(item)).toBe(800);
  });

  it("exclui o sub-desconto de FRETE do desconto de produto", () => {
    const item = itemComBreakdowns([
      {
        breakdownType: "PromoRebates",
        breakdownAmount: { currencyAmount: -12.0 },
        breakdowns: [
          {
            breakdownType: "ShippingPromotionDiscount",
            breakdownAmount: { currencyAmount: -4.0 },
          },
          {
            breakdownType: "PromotionDiscount",
            breakdownAmount: { currencyAmount: -8.0 },
          },
        ],
      },
    ]);
    expect(extrairPromoRebatesProdutoDoItemCentavos(item)).toBe(800);
  });

  it("PromoRebateAccrued tambem conta; item sem breakdowns retorna 0", () => {
    expect(
      extrairPromoRebatesProdutoDoItemCentavos(
        itemComBreakdowns([
          {
            breakdownType: "PromoRebateAccrued",
            breakdownAmount: { currencyAmount: -3.5 },
          },
        ]),
      ),
    ).toBe(350);
    expect(extrairPromoRebatesProdutoDoItemCentavos({})).toBe(0);
    expect(extrairPromoRebatesProdutoDoItemCentavos(null)).toBe(0);
  });
});
