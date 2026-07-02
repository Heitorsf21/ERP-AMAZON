import crypto from "node:crypto";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { criarEmpresa } from "@/modules/plataforma/empresas";
import { validarSlug } from "@/modules/plataforma/slug";

/**
 * Provisionamento automático de Empresa a partir de um Checkout Session da
 * landing (fluxo "paga primeiro, conta depois"). Ver spec
 * docs/superpowers/specs/2026-07-01-checkout-self-service-landing-design.md
 */

export type ProvisionamentoResult =
  | { status: "criada"; empresaId: string }
  | { status: "ja-existia"; empresaId: string }
  | { status: "ignorada"; motivo: string };

/** Slug determinístico a partir do nome da empresa: minúsculo, sem acento,
 *  hífens, 3..30 chars (formato exigido por validarSlug). */
export function slugificarNome(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  if (base.length >= 3) return base;
  return base ? `loja-${base}` : "loja";
}

async function gerarSlugDisponivel(nome: string): Promise<string> {
  const base = slugificarNome(nome);
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const candidato =
      tentativa === 0
        ? base
        : `${base.slice(0, 25)}-${crypto.randomBytes(3).toString("hex").slice(0, 4)}`;
    if (!validarSlug(candidato).ok) continue; // ex.: base caiu em slug reservado
    const ocupado = await db.empresa.findUnique({
      where: { slug: candidato },
      select: { id: true },
    });
    if (!ocupado) return candidato;
  }
  throw new Error("nao consegui gerar slug disponivel");
}

function extrairCustomerId(session: Stripe.Checkout.Session): string | null {
  const c = session.customer;
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

export async function provisionarEmpresaDoCheckout(
  session: Stripe.Checkout.Session,
): Promise<ProvisionamentoResult> {
  const customerId = extrairCustomerId(session);
  if (!customerId) return { status: "ignorada", motivo: "sem-customer" };

  const email = session.customer_details?.email?.toLowerCase().trim();
  if (!email) return { status: "ignorada", motivo: "sem-email" };

  // Idempotência: webhooks podem ser reentregues.
  const existente = await db.empresa.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  if (existente) return { status: "ja-existia", empresaId: existente.id };

  const emailEmUso = await db.usuario.findFirst({
    where: { email },
    select: { id: true },
  });
  if (emailEmUso) {
    logger.error(
      { customerId, sessionId: session.id },
      "[checkout-publico] e-mail do pagamento ja pertence a um usuario — provisionar manualmente",
    );
    return { status: "ignorada", motivo: "email-em-uso" };
  }

  const campoNome = session.custom_fields?.find((f) => f.key === "nome_empresa");
  const nomeEmpresa =
    (campoNome?.text?.value?.trim() || session.customer_details?.name?.trim() || email) as string;
  const nomeAdmin =
    (session.customer_details?.name?.trim() || email.split("@")[0]) as string;

  const slug = await gerarSlugDisponivel(nomeEmpresa);
  const criada = await criarEmpresa({
    nome: nomeEmpresa,
    slug,
    admin: { nome: nomeAdmin, email },
  });
  await db.empresa.update({
    where: { id: criada.empresaId },
    data: { stripeCustomerId: customerId },
  });
  logger.info(
    { empresaId: criada.empresaId, customerId, slug },
    "[checkout-publico] empresa provisionada via landing",
  );
  return { status: "criada", empresaId: criada.empresaId };
}