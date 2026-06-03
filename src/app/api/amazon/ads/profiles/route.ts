import { erro, handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { listAdsProfiles } from "@/lib/amazon-ads-api";
import { getAmazonAdsCredentials } from "@/modules/amazon/ads-service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireRole(UsuarioRole.ADMIN);
  const creds = await getAmazonAdsCredentials({ requireProfile: false });
  if (!creds) {
    return erro(
      400,
      "Conecte Amazon Ads por OAuth ou configure clientId/secret/refreshToken antes de listar profiles.",
    );
  }

  try {
    const profiles = await listAdsProfiles(creds);
    return ok({ profiles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return erro(502, msg);
  }
});
