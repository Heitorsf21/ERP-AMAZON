import { describe, expect, it } from "vitest";
import { assinarState, verificarState } from "./oauth";

const SECRET = "x".repeat(48);

describe("state OAuth (anti-CSRF)", () => {
  it("verifica um state válido recém-assinado", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 2000 }, SECRET);
    expect(verificarState(token, 1000, SECRET)).toEqual({ empresaId: "e1", nonce: "n1", exp: 2000 });
  });
  it("rejeita state expirado", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 500 }, SECRET);
    expect(verificarState(token, 1000, SECRET)).toBeNull();
  });
  it("rejeita state adulterado (assinatura inválida)", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 2000 }, SECRET);
    const adulterado = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(verificarState(adulterado, 1000, SECRET)).toBeNull();
  });
  it("rejeita assinatura feita com outro segredo", () => {
    const token = assinarState({ empresaId: "e1", nonce: "n1", exp: 2000 }, SECRET);
    expect(verificarState(token, 1000, "y".repeat(48))).toBeNull();
  });
});
