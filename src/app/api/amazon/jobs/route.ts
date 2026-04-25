import { handle, ok } from "@/lib/api";
import {
  ensureRecurringAmazonJobs,
  getAmazonSyncQueueSummary,
} from "@/modules/amazon/jobs";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const summary = await getAmazonSyncQueueSummary();
  return ok(summary);
});

export const POST = handle(async () => {
  const jobs = await ensureRecurringAmazonJobs();
  const summary = await getAmazonSyncQueueSummary();
  return ok({ enqueued: jobs.length, ...summary });
});
