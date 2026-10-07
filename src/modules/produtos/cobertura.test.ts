import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { calcularCobertura } from "./cobertura";

const HOJE = new Date("2026-10-06T15:00:00Z");

describe("cobertura de estoque", () => {
  it("142 un com 65 vendas em 30 d → 65 dias, Seguro", () => {
    const c = calcularCobertura({ estoque: 142, vendas30d: 65, hoje: HOJE });
    expect(c.dias).toBe(65);
    expect(c.faixa).toBe("SEGURO");
    expect(c.rupturaEm).toBe("2026-12-10");
  });

  it("21 un com 74 vendas → 8 dias, Crítico", () => {
    const c = calcularCobertura({ estoque: 21, vendas30d: 74, hoje: HOJE });
    expect(c.dias).toBe(8);
    expect(c.faixa).toBe("CRITICO");
  });

  it("sem vendas em 30 d não há como estimar", () => {
    expect(calcularCobertura({ estoque: 50, vendas30d: 0, hoje: HOJE })).toEqual({
      vendas30d: 0,
      dias: null,
      faixa: null,
      rupturaEm: null,
    });
  });
});
