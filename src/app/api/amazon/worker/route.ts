import { NextRequest, NextResponse } from "next/server";
import { handle, ok } from "@/lib/api";
import { verifyCronRequest } from "@/lib/cron-auth";
import { processAmazonSyncJobs } from "@/modules/amazon/worker";

export const dynamic = "force-dynamic";

export const GET = handle(run);
export const POST = handle(run);

async function run(req: NextRequest) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ erro: auth.motivo }, { status: 401 });
  }

  const resultado = await processAmazonSyncJobs({ limit: 10, schedule: true });
  return ok(resultado);
}
