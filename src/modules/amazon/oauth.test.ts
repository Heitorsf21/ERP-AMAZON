import { describe, expect, it } from "vitest";
import { assinarState, montarAuthorizationUrl, verificarState } from "./oauth";

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

describe("montarAuthorizationUrl", () => {
  it("inclui application_id e state; version=beta só em draft", () => {
    const url = montarAuthorizationUrl({
      sellerCentralBase: "https://sellercentral.amazon.com.br",
      applicationId: "amzn1.app.123",
      state: "STATE",
      draft: true,
    });
    expect(url).toContain("https://sellercentral.amazon.com.br/apps/authorize/consent");
    expect(url).toContain("application_id=amzn1.app.123");
    expect(url).toContain("state=STATE");
    expect(url).toContain("version=beta");
  });
  it("sem version=beta quando publicado", () => {
    const url = montarAuthorizationUrl({
      sellerCentralBase: "https://sellercentral.amazon.com.br",
      applicationId: "amzn1.app.123",
      state: "STATE",
      draft: false,
    });
    expect(url).not.toContain("version=beta");
  });
});
