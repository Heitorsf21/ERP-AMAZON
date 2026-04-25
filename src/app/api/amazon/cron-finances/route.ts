import { NextRequest, NextResponse } from "next/server";
import { handle, ok } from "@/lib/api";
import { verifyCronRequest } from "@/lib/cron-auth";
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import { processAmazonSyncJobs } from "@/modules/amazon/worker";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

export const GET = handle(run);
export const POST = handle(run);

async function run(req: NextRequest) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ erro: auth.motivo }, { status: 401 });
  }

  const finances = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.FINANCES_SYNC,
    { diasAtras: 14, maxPages: 1 },
    {
      priority: 20,
      dedupeKey: `cron:${TipoAmazonSyncJob.FINANCES_SYNC}:${Math.floor(Date.now() / (2 * 60 * 60_000))}`,
      dedupeAnyStatus: true,
    },
  );
  const refunds = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.REFUNDS_SYNC,
    { diasAtras: 90, maxPages: 1 },
    {
      priority: 20,
      dedupeKey: `cron:${TipoAmazonSyncJob.REFUNDS_SYNC}:${Math.floor(Date.now() / (2 * 60 * 60_000))}`,
      dedupeAnyStatus: true,
    },
  );
  const worker = await processAmazonSyncJobs({ limit: 2, schedule: false });
  return ok({ queued: true, jobs: [finances, refunds], worker });
}
