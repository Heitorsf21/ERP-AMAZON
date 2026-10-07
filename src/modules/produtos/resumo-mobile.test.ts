import { describe, expect, it } from "vitest";
import { calcularUnidadeEstimada, parseValorBRL, reprojetarParaPreco } from "./resumo-mobile";

describe("lucro por unidade (estimado)", () => {
  it("Kit Marinex: R$ 77,00, custo R$ 47,58 → R$ 8,40 (10,9%)", () => {
    const u = calcularUnidadeEstimada({
      precoCentavos: 7700,
      custoCentavos: 4758,
      comissaoCentavos: 924,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    expect(u.parcelamentoCentavos).toBe(116); // 1,5% de 77,00 (≥ R$ 40)
    expect(u.impostoCentavos).toBe(462);
    expect(u.lucroCentavos).toBe(840);
    expect(u.margemPercentual).toBe(10.9);
  });

  it("abaixo de R$ 40 não há parcelamento", () => {
    const u = calcularUnidadeEstimada({
      precoCentavos: 3597,
      custoCentavos: 1788,
      comissaoCentavos: 432,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    expect(u.parcelamentoCentavos).toBe(0);
  });

  it("sem custo cadastrado, lucro e margem ficam nulos", () => {
    const u = calcularUnidadeEstimada({
      precoCentavos: 7700,
      custoCentavos: null,
      comissaoCentavos: 924,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    expect(u.lucroCentavos).toBeNull();
    expect(u.margemPercentual).toBeNull();
  });

  it("reprojetar para outro preço escala a comissão e mantém FBA", () => {
    const base = calcularUnidadeEstimada({
      precoCentavos: 7700,
      custoCentavos: 4758,
      comissaoCentavos: 924,
      fbaCentavos: 600,
      impostoBps: 600,
    });
    const novo = reprojetarParaPreco(base, 7990, 600);
    expect(novo.comissaoCentavos).toBe(959); // 924 × 7990/7700
    expect(novo.fbaCentavos).toBe(600);
    expect(novo.precoCentavos).toBe(7990);
  });
});

describe("parseValorBRL", () => {
  it("aceita formatos comuns de digitação", () => {
    expect(parseValorBRL("47,58")).toBe(4758);
    expect(parseValorBRL("R$ 1.234,56")).toBe(123456);
    expect(parseValorBRL("47.58")).toBe(4758);
    expect(parseValorBRL("1.234")).toBe(123400);
    expect(parseValorBRL("77")).toBe(7700);
  });

  it("rejeita vazio, zero, negativo e texto", () => {
    expect(parseValorBRL("")).toBeNull();
    expect(parseValorBRL("0")).toBeNull();
    expect(parseValorBRL("-5")).toBeNull();
    expect(parseValorBRL("abc")).toBeNull();
  });
});
