import { describe, expect, it } from "vitest";
import { isPasswordStrong, strongPasswordSchema } from "./password-policy";

describe("strongPasswordSchema", () => {
  it("rejeita senha com menos de 12 caracteres (caso do convite antigo)", () => {
    expect(strongPasswordSchema.safeParse("Aa1!aaaa").success).toBe(false); // 8 chars
  });

  it("rejeita senha sem caractere especial", () => {
    expect(strongPasswordSchema.safeParse("Abcdefgh1234").success).toBe(false);
  });

  it("rejeita senha sem letra maiúscula", () => {
    expect(strongPasswordSchema.safeParse("abcdefgh123!").success).toBe(false);
  });

  it("aceita senha forte (>=12, mai/min/num/especial)", () => {
    expect(strongPasswordSchema.safeParse("Senha#Forte123").success).toBe(true);
  });
});

describe("isPasswordStrong", () => {
  it("true apenas quando cumpre todos os requisitos", () => {
    expect(isPasswordStrong("Senha#Forte123")).toBe(true);
    expect(isPasswordStrong("fraca")).toBe(false);
  });
});
