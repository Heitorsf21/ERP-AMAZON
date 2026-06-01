import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

export const POST = handleAuth([UsuarioRole.ADMIN], async () => {
  return ok(await adsOptimizerService.backfillHistory());
});
