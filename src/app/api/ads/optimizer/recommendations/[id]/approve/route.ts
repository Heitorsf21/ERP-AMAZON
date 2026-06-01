import { handleAuth, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = handleAuth([UsuarioRole.ADMIN], async (req: Request, { params }: Params) => {
  const [{ id }, session] = await Promise.all([
    params,
    requireRole(UsuarioRole.ADMIN),
  ]);
  const body = await req.json().catch(() => ({})) as { bidCentavos?: unknown };
  const bidCentavos =
    typeof body.bidCentavos === "number" ? Math.round(body.bidCentavos) : undefined;
  return ok(await adsOptimizerService.approveRecommendation(id, session, { bidCentavos }));
});
