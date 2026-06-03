import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { erro, handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { assinarState } from "@/modules/amazon/oauth";
import { montarAdsAuthorizationUrl } from "@/modules/amazon/ads-oauth";
import { getAmazonAdsAppCredentials } from "@/modules/amazon/ads-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) return erro(400, "SEM_EMPRESA");

  const secret = process.env.SESSION_SECRET;
  if (!secret) return erro(500, "CONFIG");

  const app = await getAmazonAdsAppCredentials();
  const requestUrl = new URL(req.url);
  const appUrl = process.env.APP_URL || requestUrl.origin;
  const redirectUri = `${appUrl}/api/amazon/ads/oauth/callback`;

  const nonce = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 600;
  const state = assinarState({ empresaId: session.empresaId, nonce, exp }, secret);

  const url = montarAdsAuthorizationUrl({
    clientId: app.clientId,
    redirectUri,
    state,
    authorizeUrl: process.env.AMAZON_ADS_LWA_AUTHORIZE_URL,
  });

  return NextResponse.redirect(url);
});
