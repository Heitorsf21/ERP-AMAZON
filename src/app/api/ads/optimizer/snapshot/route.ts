import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.ADMIN], async () => {
  return ok(await adsOptimizerService.getSnapshot());
});
