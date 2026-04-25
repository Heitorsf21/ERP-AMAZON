import { handle, ok } from "@/lib/api";
import { syncSettlementReports } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  const result = await syncSettlementReports();
  return ok(result);
});
