import { describe, expect, it } from "vitest";
import {
  montarAdsAuthorizationUrl,
  selecionarAdsProfileBrasil,
} from "./ads-oauth";

describe("montarAdsAuthorizationUrl", () => {
  it("monta consentimento LWA com scope de Amazon Ads", () => {
    const url = new URL(
      montarAdsAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "https://app.test/api/amazon/ads/oauth/callback",
        state: "STATE",
        authorizeUrl: "https://login.test/ap/oa",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://login.test/ap/oa");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe(
      "advertising::campaign_management",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.test/api/amazon/ads/oauth/callback",
    );
    expect(url.searchParams.get("state")).toBe("STATE");
  });
});

describe("selecionarAdsProfileBrasil", () => {
  it("seleciona profile BR pelo countryCode", () => {
    const profile = selecionarAdsProfileBrasil([
      { profileId: 1, countryCode: "US" },
      { profileId: 2, countryCode: "BR" },
    ]);

    expect(profile?.profileId).toBe(2);
  });

  it("seleciona profile BR pelo marketplace", () => {
    const profile = selecionarAdsProfileBrasil([
      {
        profileId: 3,
        accountInfo: { marketplaceStringId: "A2Q3Y263D00KWC" },
      },
    ]);

    expect(profile?.profileId).toBe(3);
  });

  it("retorna null quando ha multiplos profiles sem match BR unico", () => {
    const profile = selecionarAdsProfileBrasil([
      { profileId: 1, countryCode: "US" },
      { profileId: 2, countryCode: "CA" },
    ]);

    expect(profile).toBeNull();
  });
});
