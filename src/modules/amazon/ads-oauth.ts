import type { AdsProfile } from "@/lib/amazon-ads-api";
import { ADS_OAUTH_SCOPES } from "@/lib/amazon-ads-api";

const ADS_AUTHORIZE_URL = "https://www.amazon.com/ap/oa";
const AMAZON_BR_MARKETPLACE_ID = "A2Q3Y263D00KWC";

export function montarAdsAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  authorizeUrl?: string;
}): string {
  const url = new URL(opts.authorizeUrl ?? ADS_AUTHORIZE_URL);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("scope", ADS_OAUTH_SCOPES.join(" "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export function isAdsProfileBrasil(profile: AdsProfile): boolean {
  return (
    profile.countryCode === "BR" ||
    profile.accountInfo?.marketplaceStringId === AMAZON_BR_MARKETPLACE_ID
  );
}

export function selecionarAdsProfileBrasil(
  profiles: AdsProfile[],
): AdsProfile | null {
  const brasileiros = profiles.filter(isAdsProfileBrasil);
  if (brasileiros.length === 1) return brasileiros[0] ?? null;
  if (profiles.length === 1) return profiles[0] ?? null;
  return null;
}
