import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { erro, handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { encryptConfigValue } from "@/lib/crypto";
import { listAdsProfiles } from "@/lib/amazon-ads-api";
import { trocarCodePorRefreshToken, verificarState } from "@/modules/amazon/oauth";
import { selecionarAdsProfileBrasil } from "@/modules/amazon/ads-oauth";
import {
  getAmazonAdsAppCredentials,
  getAmazonAdsConfig,
} from "@/modules/amazon/ads-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  const url = new URL(req.url);
  // Redirect pós-OAuth pelo host público (APP_URL); atrás do Nginx req.url é localhost:3000.
  const appBase = process.env.APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL("/configuracoes?tab=integracoes&ads=erro", appBase),
    );
  }

  const secret = process.env.SESSION_SECRET;
  if (!code || !stateToken || !secret) return erro(400, "CALLBACK_INVALIDO");

  const state = verificarState(stateToken, Math.floor(Date.now() / 1000), secret);
  if (!state || state.empresaId !== session.empresaId) {
    return erro(400, "STATE_INVALIDO");
  }

  try {
    const config = await getAmazonAdsConfig();
    const app = await getAmazonAdsAppCredentials(config);
    const requestUrl = new URL(req.url);
    const appUrl = process.env.APP_URL || requestUrl.origin;
    const redirectUri = `${appUrl}/api/amazon/ads/oauth/callback`;
    const { refreshToken, accessToken, expiresIn } =
      await trocarCodePorRefreshToken(code, {
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        redirectUri,
      });

    let profileId: string | null = null;
    let status = "PROFILE_REQUIRED";
    try {
      const profiles = await listAdsProfiles({
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        refreshToken,
        endpoint: config.amazon_ads_endpoint || undefined,
      });
      const selecionado = selecionarAdsProfileBrasil(profiles);
      if (selecionado) {
        profileId = String(selecionado.profileId);
        status = "ATIVA";
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[amazon-ads-oauth] listagem de profiles falhou apos consentimento",
      );
    }

    const data = {
      adsRefreshTokenEnc: encryptConfigValue(refreshToken),
      adsAccessTokenEnc: encryptConfigValue(accessToken),
      adsTokenExpiresAt: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000),
      adsProfileId: profileId,
      adsEndpoint: config.amazon_ads_endpoint || null,
      adsStatus: status,
      adsConectadoEm: new Date(),
      ativa: true,
    };

    const existe = await db.amazonAccount.findFirst({
      where: { empresaId: state.empresaId },
      select: { id: true },
    });
    if (existe) {
      await db.amazonAccount.update({
        where: { id: existe.id },
        data,
      });
    } else {
      await db.amazonAccount.create({
        data: {
          empresaId: state.empresaId,
          nome: "Conta Amazon",
          status: "PENDENTE",
          ...data,
        },
      });
    }

    const destino =
      status === "ATIVA"
        ? "/configuracoes?tab=integracoes&ads=conectado"
        : "/configuracoes?tab=integracoes&ads=profile_required";
    return NextResponse.redirect(new URL(destino, appBase));
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[amazon-ads-oauth] callback falhou",
    );
    await db.amazonAccount
      .updateMany({
        where: { empresaId: state.empresaId },
        data: { adsStatus: "ERRO" },
      })
      .catch(() => {});
    return NextResponse.redirect(
      new URL("/configuracoes?tab=integracoes&ads=erro", appBase),
    );
  }
});
