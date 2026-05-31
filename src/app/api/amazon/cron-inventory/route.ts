import { NextRequest, NextResponse } from "next/server";
import { handle, ok } from "@/lib/api";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runWithWorkerTenant } from "@/lib/tenant-context";
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

  // enqueueAmazonSyncJob escreve AmazonSyncJob (modelo tenant) — precisa de
  // contexto de empresa quando TENANT_ISOLATION=enforce.
  return runWithWorkerTenant(async () => {
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.INVENTORY_SYNC,
      {},
      {
        priority: 20,
        dedupeKey: `cron:${TipoAmazonSyncJob.INVENTORY_SYNC}:${Math.floor(Date.now() / (30 * 60_000))}`,
        dedupeAnyStatus: true,
      },
    );
    const worker = await processAmazonSyncJobs({ limit: 1, schedule: false });
    return ok({ queued: true, job, worker });
  });
}
