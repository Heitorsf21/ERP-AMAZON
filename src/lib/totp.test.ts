import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";
import { gerarSegredoTotp, montarOtpauthUri, verificarTotp } from "./totp";

describe("totp", () => {
  it("gera segredo base32 não-vazio", () => {
    const s = gerarSegredoTotp();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it("verifica o código atual gerado a partir do segredo", () => {
    const s = gerarSegredoTotp();
    const token = generateSync({ secret: s });
    expect(verificarTotp(token, s)).toBe(true);
  });

  it("rejeita código errado", () => {
    const s = gerarSegredoTotp();
    const token = generateSync({ secret: s });
    const errado = token === "000000" ? "111111" : "000000";
    expect(verificarTotp(errado, s)).toBe(false);
  });

  it("rejeita formato inválido (não-6-dígitos) e segredo vazio", () => {
    const s = gerarSegredoTotp();
    expect(verificarTotp("12345", s)).toBe(false);
    expect(verificarTotp("abcdef", s)).toBe(false);
    expect(verificarTotp("123456", "")).toBe(false);
  });

  it("monta otpauth URI com issuer e label", () => {
    const s = "JBSWY3DPEHPK3PXP";
    const uri = montarOtpauthUri(s, "user@x.com", "Atlas Seller");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(`secret=${s}`);
    expect(uri).toContain("issuer=Atlas");
  });
});
