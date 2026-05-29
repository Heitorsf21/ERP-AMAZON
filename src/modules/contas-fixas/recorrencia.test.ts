import { describe, expect, it } from "vitest";
import {
  calcularMpaPosContasFixas,
  competenciaEDiaDeDataIso,
  competenciasNoIntervalo,
  diaVencimentoEfetivo,
  planejarOcorrencias,
  totalOcorrenciasCentavos,
  ultimoDiaDoMes,
  vencimentoDaCompetencia,
  type ContaFixaParaPlanejar,
} from "./recorrencia";

// Limites em meio-dia UTC para evitar ambiguidade de fuso nos testes.
const JAN = new Date("2025-01-01T12:00:00.000Z");
const MAR = new Date("2025-03-31T12:00:00.000Z");

describe("ultimoDiaDoMes / diaVencimentoEfetivo (clamp do dia 31)", () => {
  it("retorna o último dia correto por mês", () => {
    expect(ultimoDiaDoMes(2025, 1)).toBe(31);
    expect(ultimoDiaDoMes(2025, 2)).toBe(28); // fev comum
    expect(ultimoDiaDoMes(2024, 2)).toBe(29); // fev bissexto
    expect(ultimoDiaDoMes(2025, 4)).toBe(30);
  });

  it("dia 31 em fevereiro vira 28 (ou 29 em ano bissexto)", () => {
    expect(diaVencimentoEfetivo(2025, 2, 31)).toBe(28);
    expect(diaVencimentoEfetivo(2024, 2, 31)).toBe(29);
    expect(diaVencimentoEfetivo(2025, 4, 31)).toBe(30);
    expect(diaVencimentoEfetivo(2025, 1, 31)).toBe(31);
    expect(diaVencimentoEfetivo(2025, 1, 15)).toBe(15);
  });

  it("vencimentoDaCompetencia aplica o clamp e fixa meio-dia UTC", () => {
    expect(vencimentoDaCompetencia("2025-02", 31).toISOString()).toBe(
      "2025-02-28T12:00:00.000Z",
    );
    expect(vencimentoDaCompetencia("2024-02", 31).toISOString()).toBe(
      "2024-02-29T12:00:00.000Z",
    );
    expect(vencimentoDaCompetencia("2025-01", 10).toISOString()).toBe(
      "2025-01-10T12:00:00.000Z",
    );
  });
});

describe("competenciasNoIntervalo (recorrência mensal por dia)", () => {
  it("lista uma competência por mês dentro do intervalo", () => {
    expect(competenciasNoIntervalo(JAN, MAR, 10)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
    ]);
  });

  it("inclui meses mesmo quando o dia some (31 → último dia)", () => {
    expect(competenciasNoIntervalo(JAN, MAR, 31)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
    ]);
  });
});

describe("planejarOcorrencias", () => {
  const recorrente: ContaFixaParaPlanejar = {
    id: "cf1",
    valorCentavos: 10000,
    diaVencimento: 31,
    recorrente: true,
  };

  it("gera uma ocorrência por mês, com dia 31 caindo no último dia", () => {
    const occ = planejarOcorrencias([recorrente], JAN, MAR);
    expect(occ.map((o) => o.competencia)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
    ]);
    expect(occ.map((o) => o.vencimento.toISOString())).toEqual([
      "2025-01-31T12:00:00.000Z",
      "2025-02-28T12:00:00.000Z",
      "2025-03-31T12:00:00.000Z",
    ]);
    expect(totalOcorrenciasCentavos(occ)).toBe(30000);
  });

  it("é idempotente: não replaneja ocorrências já existentes", () => {
    const primeira = planejarOcorrencias([recorrente], JAN, MAR);
    const existentes = new Set(
      primeira.map((o) => `${o.contaFixaId}:${o.competencia}`),
    );
    const segunda = planejarOcorrencias([recorrente], JAN, MAR, existentes);
    expect(segunda).toHaveLength(0);

    // Existência parcial: só o mês que falta é planejado.
    const parcial = new Set(["cf1:2025-01", "cf1:2025-02"]);
    const restante = planejarOcorrencias([recorrente], JAN, MAR, parcial);
    expect(restante.map((o) => o.competencia)).toEqual(["2025-03"]);
  });

  it("competenciaEDiaDeDataIso extrai competência e dia de uma data", () => {
    expect(competenciaEDiaDeDataIso("2026-08-15")).toEqual({
      competencia: "2026-08",
      dia: 15,
    });
    expect(competenciaEDiaDeDataIso("2026-12-05")).toEqual({
      competencia: "2026-12",
      dia: 5,
    });
  });

  it("não recorrente gera apenas a competência única dentro do intervalo", () => {
    const naoRecorrente: ContaFixaParaPlanejar = {
      id: "cf2",
      valorCentavos: 5000,
      diaVencimento: 5,
      recorrente: false,
      competenciaUnica: "2025-02",
    };
    const dentro = planejarOcorrencias([naoRecorrente], JAN, MAR);
    expect(dentro.map((o) => o.competencia)).toEqual(["2025-02"]);

    // Competência única fora do intervalo → nada.
    const fora = planejarOcorrencias(
      [{ ...naoRecorrente, competenciaUnica: "2025-09" }],
      JAN,
      MAR,
    );
    expect(fora).toHaveLength(0);
  });
});

describe("calcularMpaPosContasFixas", () => {
  it("desconta as contas fixas do lucro pós-ads sobre o faturamento", () => {
    expect(
      calcularMpaPosContasFixas({
        lucroPosAdsCentavos: 100000,
        contasFixasCentavos: 30000,
        faturamentoCentavos: 200000,
      }),
    ).toBeCloseTo(35);
  });

  it("retorna null quando o lucro é desconhecido", () => {
    expect(
      calcularMpaPosContasFixas({
        lucroPosAdsCentavos: null,
        contasFixasCentavos: 0,
        faturamentoCentavos: 200000,
      }),
    ).toBeNull();
  });

  it("retorna null quando o faturamento é zero (N/A)", () => {
    expect(
      calcularMpaPosContasFixas({
        lucroPosAdsCentavos: 100000,
        contasFixasCentavos: 0,
        faturamentoCentavos: 0,
      }),
    ).toBeNull();
  });

  it("pode ficar negativo quando as fixas superam o lucro", () => {
    expect(
      calcularMpaPosContasFixas({
        lucroPosAdsCentavos: 10000,
        contasFixasCentavos: 30000,
        faturamentoCentavos: 100000,
      }),
    ).toBeCloseTo(-20);
  });
});
