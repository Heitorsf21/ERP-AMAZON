import { handleAuth, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

export const POST = handleAuth([UsuarioRole.ADMIN], async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  return ok(await adsOptimizerService.executeApproved(session));
});
