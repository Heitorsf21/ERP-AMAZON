import { handleAuth, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

export const POST = handleAuth([UsuarioRole.ADMIN], async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  const body = await req.json().catch(() => ({})) as { dryRun?: unknown };
  return ok(await adsOptimizerService.executeApproved(session, {
    dryRun: body.dryRun === true,
  }));
});
