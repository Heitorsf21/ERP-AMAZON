import { handleAuth, ok } from "@/lib/api";
import { getAmazonQuotaSnapshot } from "@/lib/amazon-rate-limit";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async () => {
  const quota = await getAmazonQuotaSnapshot();
  return ok(quota);
});
