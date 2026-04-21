import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { sendReviewSolicitation } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const body = (await req.json()) as {
    amazonOrderId?: string;
    confirm?: boolean;
  };

  if (!body.amazonOrderId) {
    throw new Error("Informe o número do pedido Amazon.");
  }

  const solicitation = await sendReviewSolicitation(
    body.amazonOrderId,
    body.confirm === true,
  );

  return ok(solicitation);
});

