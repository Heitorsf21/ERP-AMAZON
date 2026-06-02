import { erro, handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { adsOptimizerService } from "@/modules/ads-optimizer/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.ADMIN], async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku");
  if (!sku) return erro(400, "sku obrigatório");
  const limit = Number(searchParams.get("limit")) || undefined;
  const offset = Number(searchParams.get("offset")) || undefined;
  return ok(await adsOptimizerService.getHistoryBySku(sku, { limit, offset }));
});
