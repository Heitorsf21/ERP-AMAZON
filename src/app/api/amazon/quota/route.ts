import { handle, ok } from "@/lib/api";
import { getAmazonQuotaSnapshot } from "@/lib/amazon-rate-limit";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const quota = await getAmazonQuotaSnapshot();
  return ok(quota);
});
