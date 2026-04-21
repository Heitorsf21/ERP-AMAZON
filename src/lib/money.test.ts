import { describe, it, expect } from "vitest";
import {
  centavosToReais,
  formatBRL,
  parseValorBRParaCentavos,
  reaisToCentavos,
} from "./money";

describe("money", () => {
  it("converte reais para centavos arredondando corretamente", () => {
    expect(reaisToCentavos(12.34)).toBe(1234);
    expect(reaisToCentavos(0.1 + 0.2)).toBe(30);
    expect(reaisToCentavos(-5.5)).toBe(-550);
  });

  it("converte centavos para reais", () => {
    expect(centavosToReais(1234)).toBe(12.34);
    expect(centavosToReais(0)).toBe(0);
  });

  it("formata em BRL", () => {
    expect(formatBRL(1234)).toContain("12,34");
    expect(formatBRL(0)).toContain("0,00");
  });

  it("parseValorBR aceita formatos BR e ISO", () => {
    expect(parseValorBRParaCentavos("1.234,56")).toBe(123456);
    expect(parseValorBRParaCentavos("1234,56")).toBe(123456);
    expect(parseValorBRParaCentavos("1234.56")).toBe(123456);
    expect(parseValorBRParaCentavos("R$ 99,90")).toBe(9990);
  });

  it("parseValorBR rejeita entrada inválida", () => {
    expect(() => parseValorBRParaCentavos("abc")).toThrow();
    expect(() => parseValorBRParaCentavos("")).toThrow();
  });
});
