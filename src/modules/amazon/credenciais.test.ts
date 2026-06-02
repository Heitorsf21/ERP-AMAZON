import { describe, expect, it } from "vitest";
import { montarCredenciais } from "./service";

describe("montarCredenciais", () => {
  const app = { clientId: "cid", clientSecret: "sec" };

  it("mescla app-cred + conta (refresh_token decifrado)", () => {
    const creds = montarCredenciais(app, {
      refreshToken: "RT",
      marketplaceId: "MKT",
      endpoint: "https://sellingpartnerapi-na.amazon.com",
    });
    expect(creds).toEqual({
      clientId: "cid",
      clientSecret: "sec",
      refreshToken: "RT",
      marketplaceId: "MKT",
      endpoint: "https://sellingpartnerapi-na.amazon.com",
    });
  });

  it("lança quando falta refresh_token", () => {
    expect(() => montarCredenciais(app, { refreshToken: "", marketplaceId: "MKT" })).toThrow();
  });
});
