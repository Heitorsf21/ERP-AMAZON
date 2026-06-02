import { describe, it, expect } from "vitest";
import {
  planejarOcorrenciasTarefas,
  type TarefaRecorrenteParaPlanejar,
} from "./recorrencia";

const base: Omit<TarefaRecorrenteParaPlanejar, "tipoRecorrencia"> = {
  id: "r1",
  intervalo: 1,
  tipoTermino: "NUNCA",
  inicioEm: new Date("2026-06-01T12:00:00.000Z"),
};

function chaves(occ: ReturnType<typeof planejarOcorrenciasTarefas>) {
  return occ.map((o) => o.chaveOcorrencia);
}

describe("planejarOcorrenciasTarefas", () => {
  it("DIARIA gera uma ocorrencia por dia", () => {
    const occ = planejarOcorrenciasTarefas(
      { ...base, tipoRecorrencia: "DIARIA" },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-05T23:59:59Z"),
    );
    expect(chaves(occ)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ]);
  });

  it("DIARIA com intervalo 2 pula dias", () => {
    const occ = planejarOcorrenciasTarefas(
      { ...base, tipoRecorrencia: "DIARIA", intervalo: 2 },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-05T23:59:59Z"),
    );
    expect(chaves(occ)).toEqual(["2026-06-01", "2026-06-03", "2026-06-05"]);
  });

  it("SEMANAL gera apenas nos dias da semana escolhidos", () => {
    const occ = planejarOcorrenciasTarefas(
      { ...base, tipoRecorrencia: "SEMANAL", diasSemana: [1, 2] },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-14T23:59:59Z"),
    );
    // Todas as datas caem em segunda (1) ou terça (2).
    for (const o of occ) {
      expect([1, 2]).toContain(o.dataPlanejada.getUTCDay());
    }
    // Em 2 semanas, 2 dias por semana = 4 ocorrencias.
    expect(occ.length).toBe(4);
  });

  it("MENSAL com diaMes 31 clampa ao ultimo dia de fevereiro", () => {
    const occ = planejarOcorrenciasTarefas(
      {
        ...base,
        tipoRecorrencia: "MENSAL",
        diaMes: 31,
        inicioEm: new Date("2026-01-31T12:00:00Z"),
      },
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-02-28T23:59:59Z"),
    );
    expect(chaves(occ)).toEqual(["2026-02-28"]);
  });

  it("PERSONALIZADA a cada 3 dias", () => {
    const occ = planejarOcorrenciasTarefas(
      {
        ...base,
        tipoRecorrencia: "PERSONALIZADA",
        intervalo: 3,
        unidadeIntervalo: "DIAS",
      },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-10T23:59:59Z"),
    );
    expect(chaves(occ)).toEqual(["2026-06-01", "2026-06-04", "2026-06-07", "2026-06-10"]);
  });

  it("termino N_VEZES limita o total de ocorrencias", () => {
    const occ = planejarOcorrenciasTarefas(
      {
        ...base,
        tipoRecorrencia: "DIARIA",
        tipoTermino: "N_VEZES",
        terminoMaxVezes: 3,
      },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-30T23:59:59Z"),
    );
    expect(chaves(occ)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("termino DATA para na data limite", () => {
    const occ = planejarOcorrenciasTarefas(
      {
        ...base,
        tipoRecorrencia: "DIARIA",
        tipoTermino: "DATA",
        terminoAte: new Date("2026-06-03T12:00:00Z"),
      },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-30T23:59:59Z"),
    );
    expect(chaves(occ)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("idempotencia: nao repete ocorrencias ja existentes", () => {
    const occ = planejarOcorrenciasTarefas(
      { ...base, tipoRecorrencia: "DIARIA" },
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-03T23:59:59Z"),
      new Set(["2026-06-02"]),
    );
    expect(chaves(occ)).toEqual(["2026-06-01", "2026-06-03"]);
  });
});
