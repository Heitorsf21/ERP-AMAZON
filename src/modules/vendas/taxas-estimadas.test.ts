import { describe, expect, it } from "vitest";
import {
  buildCategoriaTaxaEstimada,
  deveExibirTaxaEstimadaVenda,
} from "@/modules/vendas/taxas-estimadas";

describe("taxas estimadas na aba vendas", () => {
  it("exibe estimativa para venda principal com taxa zerada e valor bruto", () => {
    expect(
      deveExibirTaxaEstimadaVenda({
        amazonOrderId: "701-123",
        sku: "MFS-0036",
        statusPedido: "UNKNOWN",
        statusFinanceiro: "PENDENTE",
        quantidade: 1,
        valorBrutoCentavos: 7999,
        taxasCentavos: 0,
      }),
    ).toBe(true);
  });

  it("nao exibe estimativa quando ja existe taxa real", () => {
    expect(
      deveExibirTaxaEstimadaVenda({
        amazonOrderId: "701-123",
        sku: "MFS-0036",
        statusPedido: "Shipped",
        statusFinanceiro: "RELEASED",
        quantidade: 1,
        valorBrutoCentavos: 7999,
        taxasCentavos: 1460,
      }),
    ).toBe(false);
  });

  it("nao estima pedidos cancelados ou sem valor", () => {
    expect(
      deveExibirTaxaEstimadaVenda({
        amazonOrderId: "701-123",
        sku: "MFS-0036",
        statusPedido: "Cancelled",
        statusFinanceiro: "PENDENTE",
        quantidade: 1,
        valorBrutoCentavos: 7999,
        taxasCentavos: 0,
      }),
    ).toBe(false);

    expect(
      deveExibirTaxaEstimadaVenda({
        amazonOrderId: "701-123",
        sku: "MFS-0036",
        statusPedido: "Pending",
        statusFinanceiro: "PENDENTE",
        quantidade: 1,
        valorBrutoCentavos: 0,
        taxasCentavos: 0,
      }),
    ).toBe(false);
  });

  it("mantem a categoria rica no detalhe da estimativa", () => {
    expect(buildCategoriaTaxaEstimada("cozinha", 1200)).toEqual({
      slug: "cozinha",
      label: "Cozinha",
      regra: "12%",
    });
  });
});
