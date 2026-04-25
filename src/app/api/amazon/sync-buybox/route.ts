import { handle, ok } from "@/lib/api";
import { syncBuybox } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  let produtoIds: string[] | undefined;

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.produtoIds)) produtoIds = body.produtoIds as string[];
  }

  const result = await syncBuybox(produtoIds);
  return ok(result);
});
