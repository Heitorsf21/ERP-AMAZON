import { handle, ok } from "@/lib/api";
import { getLogs } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const logs = await getLogs(30);
  return ok(logs);
});
