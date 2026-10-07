import { describe, expect, it } from "vitest";
import {
  calcularUnidadeEstimada,
  custoAtualDoResumo,
  parseValorBRL,
  reprojetarParaPreco,
} from "./resumo-mobile";

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

describe("custoAtualDoResumo (custo exibido e a vigência que o define)", () => {
  const hoje = new Date("2026-10-06T15:00:00.000Z");
  const EPOCH = new Date("1970-01-01T00:00:00.000Z");

  it("'A partir de hoje': a vigência aberta define custo e data", () => {
    const vigencias = [
      { custoCentavos: 4000, vigenciaInicio: new Date("2026-01-01T00:00:00.000Z"), vigenciaFim: new Date("2026-10-06T00:00:00.000Z") },
      { custoCentavos: 4758, vigenciaInicio: new Date("2026-10-06T00:00:00.000Z"), vigenciaFim: null },
    ];
    expect(custoAtualDoResumo(vigencias, 3000, hoje)).toEqual({
      centavos: 4758,
      vigenteDesde: "2026-10-06T00:00:00.000Z",
      todoHistorico: false,
    });
  });

  it("'Todo histórico': início na época vira 'vale para todo o histórico' (sem data de 1969)", () => {
    const vigencias = [{ custoCentavos: 4758, vigenciaInicio: EPOCH, vigenciaFim: null }];
    expect(custoAtualDoResumo(vigencias, 3000, hoje)).toEqual({
      centavos: 4758,
      vigenteDesde: null,
      todoHistorico: true,
    });
  });

  it("'Período' no passado: vigência encerrada não define o custo nem o rótulo", () => {
    // Período 01/03–01/05 encerrou a vigência aberta anterior em 01/03.
    const vigencias = [
      { custoCentavos: 4000, vigenciaInicio: new Date("2026-01-01T00:00:00.000Z"), vigenciaFim: new Date("2026-03-01T00:00:00.000Z") },
      { custoCentavos: 5000, vigenciaInicio: new Date("2026-03-01T00:00:00.000Z"), vigenciaFim: new Date("2026-05-01T00:00:00.000Z") },
    ];
    expect(custoAtualDoResumo(vigencias, 3000, hoje)).toEqual({
      centavos: 3000, // cai no Produto.custoUnitario, como resolverCustoUnitario
      vigenteDesde: null,
      todoHistorico: false,
    });
  });

  it("'Período' cobrindo hoje: a vigência fechada que ainda vale define custo e data", () => {
    const vigencias = [
      { custoCentavos: 5000, vigenciaInicio: new Date("2026-10-01T00:00:00.000Z"), vigenciaFim: new Date("2026-10-31T00:00:00.000Z") },
    ];
    expect(custoAtualDoResumo(vigencias, null, hoje)).toEqual({
      centavos: 5000,
      vigenteDesde: "2026-10-01T00:00:00.000Z",
      todoHistorico: false,
    });
  });

  it("sem vigência e sem custo no cadastro: tudo nulo", () => {
    expect(custoAtualDoResumo([], null, hoje)).toEqual({
      centavos: null,
      vigenteDesde: null,
      todoHistorico: false,
    });
  });

  it("vigência futura não vale hoje", () => {
    const vigencias = [
      { custoCentavos: 9999, vigenciaInicio: new Date("2026-11-01T00:00:00.000Z"), vigenciaFim: null },
    ];
    expect(custoAtualDoResumo(vigencias, 3000, hoje).centavos).toBe(3000);
  });
});
