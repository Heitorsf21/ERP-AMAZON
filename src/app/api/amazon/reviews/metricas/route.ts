import { handle, ok } from "@/lib/api";
import { getReviewMetrics } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const metricas = await getReviewMetrics();
  return ok(metricas);
});
