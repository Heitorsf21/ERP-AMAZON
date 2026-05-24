import { handleAuth, ok } from "@/lib/api";
import { getReviewMetrics } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async () => {
  const metricas = await getReviewMetrics();
  return ok(metricas);
});
