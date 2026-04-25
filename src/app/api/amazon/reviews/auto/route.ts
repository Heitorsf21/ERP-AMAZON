import { handle, ok } from "@/lib/api";
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  const discovery = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.REVIEWS_DISCOVERY,
    {},
    {
      priority: 50,
      dedupeKey: `manual:${TipoAmazonSyncJob.REVIEWS_DISCOVERY}`,
    },
  );
  const send = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.REVIEWS_SEND,
    {},
    {
      priority: 49,
      dedupeKey: `manual:${TipoAmazonSyncJob.REVIEWS_SEND}`,
    },
  );
  return ok({ ok: true, queued: true, jobs: [discovery, send] });
});
