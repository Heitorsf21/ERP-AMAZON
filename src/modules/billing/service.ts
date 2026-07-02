import type Stripe from "stripe";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireStripe } from "@/lib/stripe";
import {
  BILLING_PLANS,
  type BillingPeriod,
  type BillingPlanId,
  getStripePriceId,
} from "./plans";

type CheckoutInput = {
  empresaId: string;
  email?: string | null;
  planId: BillingPlanId;
  period: BillingPeriod;
};

function getAppUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

function getSuccessUrl(): string {
  return (
    process.env.STRIPE_CHECKOUT_SUCCESS_URL?.trim() ||
    `${getAppUrl()}/configuracoes?stripe=success&session_id={CHECKOUT_SESSION_ID}`
  );
}

function getCancelUrl(): string {
  return (
    process.env.STRIPE_CHECKOUT_CANCEL_URL?.trim() ||
    `${getAppUrl()}/configuracoes?stripe=cancelled`
  );
}

function getPortalReturnUrl(): string {
  return process.env.STRIPE_PORTAL_RETURN_URL?.trim() || `${getAppUrl()}/configuracoes`;
}

function stringId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function timestampToDate(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const raw = subscription as Stripe.Subscription & { current_period_end?: number | null };
  return timestampToDate(raw.current_period_end);
}

export async function criarCheckoutAssinatura(input: CheckoutInput): Promise<string> {
  const stripe = requireStripe();
  const empresa = await db.empresa.findUnique({
    where: { id: input.empresaId },
    select: {
      id: true,
      nome: true,
      stripeCustomerId: true,
    },
  });
  if (!empresa) throw new Error("empresa não encontrada");

  let customerId = empresa.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: empresa.nome,
      email: input.email ?? undefined,
      metadata: { empresaId: empresa.id },
    });
    customerId = customer.id;
    await db.empresa.update({
      where: { id: empresa.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const priceId = getStripePriceId(input.planId, input.period);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getSuccessUrl(),
    cancel_url: getCancelUrl(),
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    customer_update: {
      address: "auto",
      name: "auto",
    },
    metadata: {
      empresaId: empresa.id,
      plano: input.planId,
      ciclo: input.period,
    },
    subscription_data: {
      metadata: {
        empresaId: empresa.id,
        plano: input.planId,
        ciclo: input.period,
      },
    },
  });

  if (!session.url) throw new Error("checkout sem url");

  await db.empresa.update({
    where: { id: empresa.id },
    data: {
      plano: input.planId,
      cicloAssinatura: input.period,
      assinaturaStatus: "CHECKOUT_ABERTO",
      stripePriceId: priceId,
      stripeCheckoutSessionId: session.id,
      assinaturaAtualizadaEm: new Date(),
    },
  });

  return session.url;
}

type CheckoutPublicoInput = {
  planId: BillingPlanId;
  period: BillingPeriod;
};

/**
 * Checkout público da landing (Embedded). NÃO tem empresa/customer: o Stripe
 * cria o customer no pagamento e o webhook provisiona a Empresa depois
 * (provisionarEmpresaDoCheckout). Não escreve nada no banco.
 */
export async function criarCheckoutPublicoLanding(
  input: CheckoutPublicoInput,
): Promise<string> {
  const stripe = requireStripe();
  const priceId = getStripePriceId(input.planId, input.period);
  const metadata = { origem: "landing", plano: input.planId, ciclo: input.period };

  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    return_url: `${getAppUrl()}/ativar?session_id={CHECKOUT_SESSION_ID}`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    tax_id_collection: { enabled: true },
    custom_fields: [
      {
        key: "nome_empresa",
        label: { type: "custom", custom: "Nome da sua empresa/loja" },
        type: "text",
      },
    ],
    metadata,
    subscription_data: { metadata },
  });

  if (!session.client_secret) throw new Error("checkout sem client_secret");
  return session.client_secret;
}

export async function criarPortalAssinatura(empresaId: string): Promise<string> {
  const stripe = requireStripe();
  const empresa = await db.empresa.findUnique({
    where: { id: empresaId },
    select: { stripeCustomerId: true },
  });
  if (!empresa?.stripeCustomerId) throw new Error("cliente Stripe não encontrado");

  const session = await stripe.billingPortal.sessions.create({
    customer: empresa.stripeCustomerId,
    return_url: getPortalReturnUrl(),
  });

  return session.url;
}

async function aplicarAssinaturaStripe(subscription: Stripe.Subscription): Promise<void> {
  const customerId = stringId(subscription.customer);
  const subscriptionId = subscription.id;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const planId = subscription.metadata.plano || null;
  const period = subscription.metadata.ciclo || null;
  const empresaId = subscription.metadata.empresaId || null;

  const where = empresaId
    ? { id: empresaId }
    : customerId
      ? { stripeCustomerId: customerId }
      : null;

  if (!where) {
    logger.warn({ subscriptionId }, "[stripe] assinatura sem empresa/customer");
    return;
  }

  await db.empresa.updateMany({
    where,
    data: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      plano: planId,
      cicloAssinatura: period,
      assinaturaStatus: subscription.status.toUpperCase(),
      stripeCurrentPeriodEnd: subscriptionPeriodEnd(subscription),
      assinaturaAtualizadaEm: new Date(),
    },
  });
}

async function marcarFalhaPagamento(invoice: Stripe.Invoice): Promise<void> {
  const customerId = stringId(invoice.customer);
  if (!customerId) return;

  await db.empresa.updateMany({
    where: { stripeCustomerId: customerId },
    data: {
      assinaturaStatus: "PAGAMENTO_FALHOU",
      assinaturaAtualizadaEm: new Date(),
    },
  });
}

export async function processarEventoStripe(event: Stripe.Event): Promise<void> {
  const stripe = requireStripe();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = stringId(session.subscription);
      if (!subscriptionId) return;

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await aplicarAssinaturaStripe(subscription);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await aplicarAssinaturaStripe(event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = stringId(
        (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null })
          .subscription,
      );
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await aplicarAssinaturaStripe(subscription);
      }
      break;
    }
    case "invoice.payment_failed": {
      await marcarFalhaPagamento(event.data.object as Stripe.Invoice);
      break;
    }
    default:
      logger.debug({ eventType: event.type }, "[stripe] evento ignorado");
  }
}

export function listarPlanosBilling() {
  return Object.entries(BILLING_PLANS).map(([id, config]) => ({
    id,
    label: config.label,
    periodos: Object.keys(config.priceEnv),
  }));
}
