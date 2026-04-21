import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { processEligibleReviewSolicitations } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { diasAtras?: number };
  const result = await processEligibleReviewSolicitations(body.diasAtras ?? 30);
  return ok(result);
});

