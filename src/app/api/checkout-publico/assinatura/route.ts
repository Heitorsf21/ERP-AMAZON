import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { consumeRateLimit, getClientIp } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";
import { parseBillingPeriod, parseBillingPlanId } from "@/modules/billing/plans";
import { criarAssinaturaPublicaLanding } from "@/modules/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO consumido pela landing (site estático em outro domínio).
// Fluxo Elements (form próprio): cria Customer BR + Subscription incomplete
// no Stripe e devolve o client_secret do PaymentIntent para o front
// confirmar o pagamento. Proteções: CORS restrito + rate-limit por IP.

const RATE_WINDOW_MS = 15 * 60_000;
const RATE_MAX = 10;

const schema = z.object({
  plano: z.string(),
  ciclo: z.string().optional(),
  nome: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  cpfCnpj: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((v) => v.length === 11 || v.length === 14, "CPF/CNPJ inválido"),
  celular: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((v) => v.length >= 10 && v.length <= 13, "celular inválido"),
  nomeEmpresa: z.string().trim().max(80).optional(),
});

function origemPermitida(): string | null {
  return process.env.CHECKOUT_PUBLICO_ORIGEM?.trim().replace(/\/$/, "") || null;
}

function corsHeaders(origem: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  const permitida = origemPermitida();
  const origin = req.headers.get("origin");
  if (!permitida || origin !== permitida) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(permitida) });
}

export const POST = handle(async (req: Request) => {
  const permitida = origemPermitida();
  const origin = req.headers.get("origin");
  // Navegador manda Origin; só aceitamos o da landing. Sem Origin
  // (curl/server-to-server) segue — CORS é proteção de navegador, e o
  // rate-limit abaixo cobre abuso direto.
  if (origin && origin !== permitida) {
    return NextResponse.json(
      { erro: "ORIGEM_INVALIDA" },
      { status: 403, headers: { Vary: "Origin" } },
    );
  }
  const headers = origin && permitida ? corsHeaders(permitida) : undefined;

  const ip = getClientIp(req.headers);
  const rl = await consumeRateLimit(`checkout-assinatura:${ip}`, RATE_WINDOW_MS, RATE_MAX);
  if (rl.limited) {
    return NextResponse.json(
      { erro: "MUITAS_TENTATIVAS" },
      { status: 429, headers: { ...headers, "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  // A partir daqui qualquer exceção (JSON inválido, dados inválidos, CPF/CNPJ
  // rejeitado pelo Stripe, env do Stripe ausente, falha na API do Stripe)
  // precisa devolver os mesmos headers de CORS — senão o navegador da landing
  // (cross-origin) vê uma falha de CORS opaca em vez do JSON de erro. O
  // `handle` externo continua como rede de segurança para qualquer coisa que
  // escape daqui.
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400, headers });
    }
    const data = parsed.data;

    const planId = parseBillingPlanId(data.plano);
    const period = parseBillingPeriod(data.ciclo ?? "mensal");

    const clientSecret = await criarAssinaturaPublicaLanding({
      planId,
      period,
      nome: data.nome,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      celular: data.celular,
      nomeEmpresa: data.nomeEmpresa,
    });
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
    if (!publishableKey) throw new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY não configurada");

    return NextResponse.json({ clientSecret, publishableKey }, { headers });
  } catch (e) {
    const stripeCode = (e as { code?: string } | null)?.code;
    if (stripeCode === "tax_id_invalid") {
      logger.warn({ err: stripeCode }, "[checkout-publico] cpf/cnpj invalido no Stripe");
      return NextResponse.json({ erro: "CPF_CNPJ_INVALIDO" }, { status: 400, headers });
    }
    if (e instanceof Error) {
      logger.warn({ err: e.message }, "[checkout-publico] falha ao criar assinatura");
      return NextResponse.json({ erro: "requisicao invalida" }, { status: 400, headers });
    }
    logger.error({ err: e }, "[checkout-publico] erro inesperado na assinatura");
    return NextResponse.json({ erro: "erro inesperado" }, { status: 500, headers });
  }
});
