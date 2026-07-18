import { describe, expect, it } from "vitest";
import { precisaEstimativaTaxas } from "./service";

describe("precisaEstimativaTaxas (dashboard — estimativa de taxa in-memory)", () => {
  it("estima PENDENTE sem taxa real", () => {
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 0, statusFinanceiro: "PENDENTE" }),
    ).toBe(true);
  });

  it("NÃO estima DEFERRED: a Amazon já enviou a transação (taxa real, 0 se conta isenta)", () => {
    // statusFinanceiro só vira DEFERRED quando a AmazonFinanceTransaction chega.
    // Nesse ponto a taxa (mesmo 0, por isenção da conta) é REAL — estimar
    // inventaria uma comissão/FBA fantasma e reduziria a margem falsamente,
    // divergindo da aba de vendas (que usa a transação real).
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 0, statusFinanceiro: "DEFERRED" }),
    ).toBe(false);
  });

  it("NÃO estima quando já há taxa real (mesmo DEFERRED)", () => {
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 1094, statusFinanceiro: "DEFERRED" }),
    ).toBe(false);
  });

  it("NÃO estima RELEASED (liquidado) nem REEMBOLSADO", () => {
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 0, statusFinanceiro: "RELEASED" }),
    ).toBe(false);
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 0, statusFinanceiro: "REEMBOLSADO" }),
    ).toBe(false);
  });
});
