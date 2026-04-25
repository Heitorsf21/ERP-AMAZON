import { handle, ok } from "@/lib/api";
import { resolverPeriodoDeBusca } from "@/lib/periodo";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const periodo = resolverPeriodoDeBusca(searchParams);
  const timeline = await dashboardEcommerceService.obterTimeline(periodo);
  return ok(timeline);
});
