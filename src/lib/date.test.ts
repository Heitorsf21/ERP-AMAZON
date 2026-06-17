import { describe, expect, it } from "vitest";
import { inicioMesSP, fimMesSP } from "./date";

describe("inicioMesSP / fimMesSP (America/Sao_Paulo, UTC-3)", () => {
  it("inicioMesSP retorna o 1º dia do mês às 00:00 SP (03:00 UTC)", () => {
    const d = new Date("2026-06-17T10:00:00.000Z");
    expect(inicioMesSP(d).toISOString()).toBe("2026-06-01T03:00:00.000Z");
  });

  it("fimMesSP retorna o último instante do mês em SP (02:59:59.999 UTC do dia seguinte)", () => {
    const d = new Date("2026-06-17T10:00:00.000Z");
    expect(fimMesSP(d).toISOString()).toBe("2026-07-01T02:59:59.999Z");
  });

  it("01/07 01:00 UTC ainda é JUNHO em SP (caso que o cálculo manual com offset fixo errava)", () => {
    // 2026-07-01T01:00 UTC = 2026-06-30T22:00 SP → mês de junho
    const d = new Date("2026-07-01T01:00:00.000Z");
    expect(inicioMesSP(d).toISOString()).toBe("2026-06-01T03:00:00.000Z");
    expect(fimMesSP(d).toISOString()).toBe("2026-07-01T02:59:59.999Z");
  });

  it("fevereiro de 2026 (28 dias)", () => {
    const d = new Date("2026-02-15T12:00:00.000Z");
    expect(inicioMesSP(d).toISOString()).toBe("2026-02-01T03:00:00.000Z");
    expect(fimMesSP(d).toISOString()).toBe("2026-03-01T02:59:59.999Z");
  });
});
