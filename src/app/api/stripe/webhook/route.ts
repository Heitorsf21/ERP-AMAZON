import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireStripe } from "@/lib/stripe";
import { processarEventoStripe } from "@/modules/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = requireStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");

  if (!webhookSecret || !signature) {
    return NextResponse.json({ erro: "WEBHOOK_CONFIG_INVALIDA" }, { status: 400 });
  }

  const body = await req.text();

  try {
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    await processarEventoStripe(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[stripe] webhook inválido",
    );
    return NextResponse.json({ erro: "WEBHOOK_INVALIDO" }, { status: 400 });
  }
}
