import { describe, it, expect } from "vitest";
import { validarSlug, SLUGS_RESERVADOS } from "./slug";

describe("validarSlug", () => {
  it("aceita slug valido", () => {
    expect(validarSlug("lojax")).toEqual({ ok: true });
    expect(validarSlug("loja-2026")).toEqual({ ok: true });
  });
  it("rejeita formato invalido", () => {
    expect(validarSlug("Lo").ok).toBe(false);        // curto + maiuscula
    expect(validarSlug("loja_x").ok).toBe(false);    // underscore
    expect(validarSlug("LOJA").ok).toBe(false);      // maiuscula
    expect(validarSlug("a".repeat(31)).ok).toBe(false); // > 30
  });
  it("rejeita reservados", () => {
    for (const r of SLUGS_RESERVADOS) {
      expect(validarSlug(r).ok).toBe(false);
    }
  });
});
