import { describe, expect, it } from "vitest";
import { isMaskedSecret, maskSecretForDisplay } from "./crypto";

describe("maskSecretForDisplay", () => {
  it("mascara sem revelar tamanho nem trecho do segredo", () => {
    expect(maskSecretForDisplay("super-secret-refresh-token-abcd")).toBe("********");
    expect(maskSecretForDisplay("x")).toBe("********");
  });

  it("vazio/null permanece vazio (não inventa máscara)", () => {
    expect(maskSecretForDisplay("")).toBe("");
    expect(maskSecretForDisplay(null)).toBe("");
    expect(maskSecretForDisplay(undefined)).toBe("");
  });
});

describe("isMaskedSecret", () => {
  it("detecta a máscara reenviada pela UI", () => {
    expect(isMaskedSecret("********")).toBe(true);
    expect(isMaskedSecret("  ****  ")).toBe(true);
  });

  it("valor real não é considerado máscara", () => {
    expect(isMaskedSecret("abcd1234")).toBe(false);
    expect(isMaskedSecret("")).toBe(false);
  });
});
