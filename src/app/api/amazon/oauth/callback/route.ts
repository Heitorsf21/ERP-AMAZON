import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { erro, handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { encryptConfigValue } from "@/lib/crypto";
import { trocarCodePorRefreshToken, verificarState } from "@/modules/amazon/oauth";
import { getAppCredentials } from "@/modules/amazon/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// T7 (F02): callback do consentimento. A Amazon redireciona o browser (navegação
// top-level → cookie de sessão sob sameSite=lax). NÃO é rota pública: passa pela
// auth normal (proxy exige ADMIN em /api/amazon). Valida o state assinado e exige
// state.empresaId === session.empresaId (binding anti-CSRF), troca o code por
// refresh_token e grava cifrado no AmazonAccount da empresa.
export const GET = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  const url = new URL(req.url);
  const code = url.searchParams.get("spapi_oauth_code");
  const stateToken = url.searchParams.get("state");
  const sellerId = url.searchParams.get("selling_partner_id");

  const secret = process.env.SESSION_SECRET;
  if (!code || !stateToken || !secret) return erro(400, "CALLBACK_INVALIDO");

  const state = verificarState(stateToken, Math.floor(Date.now() / 1000), secret);
  // Binding anti-CSRF: o state TEM que ser da mesma empresa logada.
  if (!state || state.empresaId !== session.empresaId) {
    return erro(400, "STATE_INVALIDO");
  }

  try {
    const app = await getAppCredentials();
    const redirectUri = `${process.env.APP_URL ?? ""}/api/amazon/oauth/callback`;
    const { refreshToken } = await trocarCodePorRefreshToken(code, {
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUri,
    });

    const enc = encryptConfigValue(refreshToken);
    const existe = await db.amazonAccount.findFirst({
      where: { empresaId: state.empresaId },
    });
    if (existe) {
      await db.amazonAccount.updateMany({
        where: { empresaId: state.empresaId },
        data: {
          refreshTokenEnc: enc,
          sellerId: sellerId ?? undefined,
          status: "ATIVA",
          ativa: true,
          conectadoEm: new Date(),
        },
      });
    } else {
      await db.amazonAccount.create({
        data: {
          empresaId: state.empresaId,
          nome: "Conta Amazon",
          sellerId: sellerId ?? undefined,
          refreshTokenEnc: enc,
          status: "ATIVA",
          conectadoEm: new Date(),
        },
      });
    }

    return NextResponse.redirect(new URL("/amazon?conectado=1", req.url));
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[amazon-oauth] callback falhou",
    );
    await db.amazonAccount
      .updateMany({ where: { empresaId: state.empresaId }, data: { status: "ERRO" } })
      .catch(() => {});
    return NextResponse.redirect(new URL("/amazon?erro=oauth", req.url));
  }
});
