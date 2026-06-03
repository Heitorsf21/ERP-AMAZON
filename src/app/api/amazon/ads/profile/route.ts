import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { erro, handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { listAdsProfiles } from "@/lib/amazon-ads-api";
import { resolverAdsCredenciaisDaConta } from "@/modules/amazon/ads-service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  if (!session.empresaId) return erro(400, "SEM_EMPRESA");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const profileId = String(body.profileId ?? "").trim();
  if (!profileId) return erro(400, "PROFILE_ID_OBRIGATORIO");

  const creds = await resolverAdsCredenciaisDaConta(session.empresaId, {
    requireProfile: false,
  });
  if (!creds) return erro(400, "ADS_OAUTH_NAO_CONECTADO");

  const profiles = await listAdsProfiles(creds);
  const existe = profiles.some((profile) => String(profile.profileId) === profileId);
  if (!existe) return erro(400, "PROFILE_ID_INVALIDO");

  await db.amazonAccount.updateMany({
    where: { empresaId: session.empresaId },
    data: {
      adsProfileId: profileId,
      adsEndpoint: creds.endpoint ?? null,
      adsStatus: "ATIVA",
    },
  });

  return ok({ ok: true, profileId });
});
