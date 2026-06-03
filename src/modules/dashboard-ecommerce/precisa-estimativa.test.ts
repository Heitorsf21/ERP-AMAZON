import { describe, expect, it } from "vitest";
import { precisaEstimativaTaxas } from "./service";

describe("precisaEstimativaTaxas (dashboard — estimativa de taxa in-memory)", () => {
  it("estima PENDENTE sem taxa real", () => {
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 0, statusFinanceiro: "PENDENTE" }),
    ).toBe(true);
  });

  it("estima DEFERRED sem taxa real (bug que inflava o dashboard)", () => {
    expect(
      precisaEstimativaTaxas({ taxasCentavos: 0, statusFinanceiro: "DEFERRED" }),
    ).toBe(true);
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
