import { describe, expect, it } from "vitest";
import {
  assinarState,
  montarAuthorizationUrl,
  trocarCodePorRefreshToken,
  verificarState,
} from "./oauth";

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

describe("trocarCodePorRefreshToken", () => {
  const creds = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };

  it("retorna refresh/access token no sucesso", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ refresh_token: "RT", access_token: "AT", expires_in: 3600 }), { status: 200 });
    const r = await trocarCodePorRefreshToken("CODE", creds, fakeFetch as typeof fetch);
    expect(r).toEqual({ refreshToken: "RT", accessToken: "AT", expiresIn: 3600 });
  });

  it("lança quando a Amazon responde erro", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    await expect(trocarCodePorRefreshToken("CODE", creds, fakeFetch as typeof fetch)).rejects.toThrow();
  });

  it("lança quando falta refresh_token na resposta", async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ access_token: "AT" }), { status: 200 });
    await expect(trocarCodePorRefreshToken("CODE", creds, fakeFetch as typeof fetch)).rejects.toThrow();
  });
});
