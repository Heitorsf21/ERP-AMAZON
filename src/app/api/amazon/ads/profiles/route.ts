import { erro, handle, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { listAdsProfiles } from "@/lib/amazon-ads-api";
import {
  getAmazonAdsConfig,
  buildAdsCredentials,
  ADS_REQUIRED_CONFIG_KEYS,
} from "@/modules/amazon/ads-service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireRole(UsuarioRole.ADMIN);
  const config = await getAmazonAdsConfig();
  const missing = ADS_REQUIRED_CONFIG_KEYS.filter((k) => !config[k]);
  if (missing.length > 0) {
    return erro(400, `Campos ausentes no banco: ${missing.join(", ")}`);
  }
  const creds = buildAdsCredentials(config);
  if (!creds) {
    return erro(
      400,
      "Configure clientId/secret/refreshToken antes de listar profiles.",
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
