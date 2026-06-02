import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { erro, handle } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { assinarState, montarAuthorizationUrl } from "@/modules/amazon/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// T6 (F02): inicia o consentimento OAuth. Gera um state assinado (empresaId da
// sessão + nonce + exp) e redireciona o ADMIN para o Seller Central. A rota já é
// gateada a ADMIN pelo proxy (/api/amazon prefix); requireRole é defesa extra.
export const GET = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) return erro(400, "SEM_EMPRESA");

  const secret = process.env.SESSION_SECRET;
  if (!secret) return erro(500, "CONFIG");

  const nonce = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 600; // 10 min
  const state = assinarState({ empresaId: session.empresaId, nonce, exp }, secret);

  const url = montarAuthorizationUrl({
    sellerCentralBase:
      process.env.AMAZON_SELLERCENTRAL_BASE ?? "https://sellercentral.amazon.com.br",
    applicationId: process.env.AMAZON_APP_ID ?? "",
    state,
    draft: process.env.AMAZON_OAUTH_DRAFT === "true",
  });
  return NextResponse.redirect(url);
});
