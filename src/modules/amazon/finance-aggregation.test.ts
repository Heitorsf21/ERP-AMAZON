import { describe, expect, it } from "vitest";
import { agruparValoresFinanceirosVendaAmazon } from "./finance-aggregation";

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
