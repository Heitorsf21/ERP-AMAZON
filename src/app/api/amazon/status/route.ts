import { handleAuth, ok } from "@/lib/api";
import { getLogs } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async () => {
  const logs = await getLogs(30);
  return ok(logs);
});
