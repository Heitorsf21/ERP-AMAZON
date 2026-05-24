import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import {
  ensureRecurringAmazonJobs,
  getAmazonSyncQueueSummary,
} from "@/modules/amazon/jobs";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.ADMIN], async () => {
  const summary = await getAmazonSyncQueueSummary();
  return ok(summary);
});

export const POST = handleAuth([UsuarioRole.ADMIN], async () => {
  const jobs = await ensureRecurringAmazonJobs();
  const summary = await getAmazonSyncQueueSummary();
  return ok({ enqueued: jobs.length, ...summary });
});
