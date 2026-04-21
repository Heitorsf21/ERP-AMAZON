import { describe, expect, it } from "vitest";
import { TipoMovimentacao } from "@/modules/shared/domain";
import {
  saldoDeMovimentacoes,
  saldoProjetado,
  validarLinhaImportacao,
} from "../service";
import {
  ajusteSaldoSchema,
  filtrosMovimentacaoSchema,
  linhaImportacaoSchema,
  novaMovimentacaoSchema,
} from "../schemas";

describe("saldoDeMovimentacoes", () => {
  it("é zero sem movimentações", () => {
    expect(saldoDeMovimentacoes([])).toBe(0);
  });

  it("soma entradas e subtrai saídas em centavos", () => {
    const movs = [
      { tipo: TipoMovimentacao.ENTRADA, valor: 100_000 }, // +R$1.000
      { tipo: TipoMovimentacao.SAIDA, valor: 30_000 }, //   −R$300
      { tipo: TipoMovimentacao.ENTRADA, valor: 5_000 }, //   +R$50
    ];
    expect(saldoDeMovimentacoes(movs)).toBe(75_000);
  });

  it("ignora tipos desconhecidos (defensivo)", () => {
    const movs = [
      { tipo: "ENTRADA", valor: 10_000 },
      { tipo: "ALIENIGENA", valor: 99_999 },
    ];
    expect(saldoDeMovimentacoes(movs)).toBe(10_000);
  });

  it("permite saldo negativo", () => {
    const movs = [{ tipo: TipoMovimentacao.SAIDA, valor: 100 }];
    expect(saldoDeMovimentacoes(movs)).toBe(-100);
  });

  it("entrada e saída iguais zeram o saldo (estorno)", () => {
    const movs = [
      { tipo: TipoMovimentacao.ENTRADA, valor: 12_345 },
      { tipo: TipoMovimentacao.SAIDA, valor: 12_345 },
    ];
    expect(saldoDeMovimentacoes(movs)).toBe(0);
  });
});

describe("saldoProjetado", () => {
  const d = (iso: string) => new Date(iso);

  it("sem contas, retorna o saldo atual intacto", () => {
    expect(saldoProjetado(100_000, [], d("2026-04-30T23:59:59Z"))).toBe(100_000);
  });

  it("subtrai apenas contas cujo vencimento cai até a data alvo", () => {
    const contas = [
      { valor: 20_000, vencimento: d("2026-04-20T12:00:00Z") }, // dentro de 7d
      { valor: 15_000, vencimento: d("2026-04-25T12:00:00Z") }, // fora de 7d
    ];
    const ate7d = d("2026-04-22T23:59:59Z");
    expect(saldoProjetado(100_000, contas, ate7d)).toBe(80_000);
  });

  it("subtrai todas quando todas vencem antes ou na data alvo", () => {
    const contas = [
      { valor: 10_000, vencimento: d("2026-04-10T12:00:00Z") },
      { valor: 25_000, vencimento: d("2026-04-15T12:00:00Z") },
    ];
    const ate30d = d("2026-04-30T23:59:59Z");
    expect(saldoProjetado(100_000, contas, ate30d)).toBe(65_000);
  });

  it("permite resultado negativo (comprometido > saldo)", () => {
    const contas = [{ valor: 200_000, vencimento: d("2026-04-10T12:00:00Z") }];
    expect(saldoProjetado(100_000, contas, d("2026-04-30T23:59:59Z"))).toBe(-100_000);
  });

  it("ignora contas com vencimento exatamente no dia seguinte ao alvo", () => {
    const contas = [
      { valor: 5_000, vencimento: d("2026-04-16T00:00:01Z") }, // > ate
    ];
    const ate = d("2026-04-15T23:59:59Z");
    expect(saldoProjetado(50_000, contas, ate)).toBe(50_000);
  });
});

describe("ajusteSaldoSchema", () => {
  it("exige motivoAjuste com pelo menos 3 caracteres", () => {
    const entrada = {
      tipo: TipoMovimentacao.SAIDA,
      valorCentavos: 1000,
      dataCaixa: new Date("2026-04-15"),
      categoriaId: "cat_1",
      descricao: "taxa não lançada",
      motivoAjuste: "ab",
    };
    const r = ajusteSaldoSchema.safeParse(entrada);
    expect(r.success).toBe(false);
  });

  it("aceita ajuste válido", () => {
    const entrada = {
      tipo: TipoMovimentacao.SAIDA,
      valorCentavos: 1000,
      dataCaixa: new Date("2026-04-15"),
      categoriaId: "cat_1",
      descricao: "taxa não lançada",
      motivoAjuste: "taxa bancária descoberta na conciliação",
    };
    expect(ajusteSaldoSchema.safeParse(entrada).success).toBe(true);
  });
});

describe("novaMovimentacaoSchema", () => {
  it("rejeita valor <= 0", () => {
    const base = {
      tipo: TipoMovimentacao.ENTRADA,
      dataCaixa: new Date(),
      categoriaId: "c",
      descricao: "x",
    };
    expect(
      novaMovimentacaoSchema.safeParse({ ...base, valorCentavos: 0 }).success,
    ).toBe(false);
    expect(
      novaMovimentacaoSchema.safeParse({ ...base, valorCentavos: -1 }).success,
    ).toBe(false);
  });
});

describe("linhaImportacaoSchema", () => {
  it("converte valor negativo em SAIDA e preserva o módulo", () => {
    const r = linhaImportacaoSchema.parse({
      data: "2026-04-15",
      descricao: "compra mercado",
      valorCentavos: -4599,
      categoriaId: "cat_x",
    });
    expect(r.tipo).toBe(TipoMovimentacao.SAIDA);
    expect(r.valorCentavos).toBe(4599);
  });

  it("converte valor positivo em ENTRADA", () => {
    const r = linhaImportacaoSchema.parse({
      data: "2026-04-15",
      descricao: "venda",
      valorCentavos: 15000,
      categoriaId: "cat_x",
    });
    expect(r.tipo).toBe(TipoMovimentacao.ENTRADA);
    expect(r.valorCentavos).toBe(15000);
  });

  it("rejeita valor zero", () => {
    const r = validarLinhaImportacao({
      data: "2026-04-15",
      descricao: "zerada",
      valorCentavos: 0,
      categoriaId: "cat_x",
    });
    expect(r.success).toBe(false);
  });
});

describe("filtrosMovimentacaoSchema", () => {
  it("coage strings ISO em Date", () => {
    const r = filtrosMovimentacaoSchema.parse({
      de: "2026-04-01",
      ate: "2026-04-30",
    });
    expect(r.de).toBeInstanceOf(Date);
    expect(r.ate).toBeInstanceOf(Date);
  });

  it("aceita objeto vazio", () => {
    expect(filtrosMovimentacaoSchema.parse({})).toEqual({});
  });

  // Regressão: strings yyyy-MM-dd devem ser tratadas como datas em SP, não UTC.
  // Antes do fix, "2026-04-15" virava 15/04 00:00 UTC = 14/04 21:00 SP, o que
  // cortava o dia inteiro do filtro "ate" e empurrava movimentações do form
  // para o dia anterior.
  it("de: yyyy-MM-dd vira início do dia em SP (03:00 UTC)", () => {
    const r = filtrosMovimentacaoSchema.parse({ de: "2026-04-15" });
    expect(r.de?.toISOString()).toBe("2026-04-15T03:00:00.000Z");
  });

  it("ate: yyyy-MM-dd vira fim do dia em SP (02:59:59.999 UTC do dia seguinte)", () => {
    const r = filtrosMovimentacaoSchema.parse({ ate: "2026-04-15" });
    expect(r.ate?.toISOString()).toBe("2026-04-16T02:59:59.999Z");
  });
});

describe("novaMovimentacaoSchema — fuso horário", () => {
  it("dataCaixa 'yyyy-MM-dd' é interpretada como meia-noite SP, não UTC", () => {
    const r = novaMovimentacaoSchema.parse({
      tipo: TipoMovimentacao.ENTRADA,
      valorCentavos: 1000,
      dataCaixa: "2026-04-15",
      categoriaId: "c",
      descricao: "x",
    });
    expect(r.dataCaixa.toISOString()).toBe("2026-04-15T03:00:00.000Z");
  });

  it("dataCaixa 'dd/MM/yyyy' também vira meia-noite SP", () => {
    const r = novaMovimentacaoSchema.parse({
      tipo: TipoMovimentacao.ENTRADA,
      valorCentavos: 1000,
      dataCaixa: "15/04/2026",
      categoriaId: "c",
      descricao: "x",
    });
    expect(r.dataCaixa.toISOString()).toBe("2026-04-15T03:00:00.000Z");
  });
});
