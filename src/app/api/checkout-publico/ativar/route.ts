import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { consumeRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import { originViolationResponse } from "@/lib/origin-check";
import { requireStripe } from "@/lib/stripe";
import { ativarPorCustomer } from "@/modules/billing/ativacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ativação pós-pagamento (chamada pela página /ativar, same-origin).
// O identificador (session_id do Checkout ou payment_intent do Elements) é a
// credencial: só quem pagou o recebe (return_url do Stripe) e ele é validado
// server-side abaixo. Vira inerte depois da 1ª senha definida (ver ativarPorCustomer).

const schema = z
  .object({
    sessionId: z.string().min(10).max(200).optional(),
    paymentIntentId: z.string().min(10).max(200).optional(),
  })
  .refine((d) => !!d.sessionId !== !!d.paymentIntentId, "exatamente um identificador");

async function responderAtivacao(customerId: string) {
  const resultado = await ativarPorCustomer(customerId);
  if (resultado.status === "processando") {
    return NextResponse.json({ status: "processando" }, { status: 202 });
  }
  if (resultado.status === "ja-ativo") {
    return NextResponse.json({ status: "ja-ativo" });
  }

  const qs = new URLSearchParams({ token: resultado.token });
  if (resultado.empresaNome) qs.set("empresa", resultado.empresaNome);
  if (resultado.email) qs.set("email", resultado.email);
  return NextResponse.json({ status: "pronto", redirectTo: `/definir-senha?${qs.toString()}` });
}

export const POST = handle(async (req: Request) => {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;

  const ip = getClientIp(req.headers);
  const rl = await consumeRateLimit(`ativar-checkout:${ip}`, 15 * 60_000, 30);
  if (rl.limited) {
    return NextResponse.json(
      { erro: "MUITAS_TENTATIVAS" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const stripe = requireStripe();

  if (parsed.data.paymentIntentId) {
    // PaymentIntent inexistente => StripeInvalidRequestError => handle() devolve 400.
    const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
    const pago = pi.status === "succeeded";
    const customerId = typeof pi.customer === "string" ? pi.customer : (pi.customer?.id ?? null);
    if (!pago || !customerId) {
      return NextResponse.json({ status: "nao-pago" }, { status: 402 });
    }
    return responderAtivacao(customerId);
  }

  // Session inexistente => StripeInvalidRequestError => handle() devolve 400.
  const session = await stripe.checkout.sessions.retrieve(parsed.data.sessionId as string);
  const pago = session.payment_status === "paid" || session.status === "complete";
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!pago || !customerId) {
    return NextResponse.json({ status: "nao-pago" }, { status: 402 });
  }

  return responderAtivacao(customerId);
});
