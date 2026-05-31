import { handleAuth, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = handleAuth([UsuarioRole.ADMIN], async (_req: Request, { params }: Params) => {
  const [{ id }, session] = await Promise.all([
    params,
    requireRole(UsuarioRole.ADMIN),
  ]);
  return ok(await adsOptimizerService.approveRecommendation(id, session));
});
