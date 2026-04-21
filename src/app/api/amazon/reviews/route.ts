import { handle, ok } from "@/lib/api";
import { listReviewSolicitations } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const solicitations = await listReviewSolicitations();
  return ok(solicitations);
});

