/**
 * Provisionamento automático de Empresa a partir de um Checkout Session da
 * landing (fluxo "paga primeiro, conta depois"). Ver spec
 * docs/superpowers/specs/2026-07-01-checkout-self-service-landing-design.md
 */

/** Slug determinístico a partir do nome da empresa: minúsculo, sem acento,
 *  hífens, 3..30 chars (formato exigido por validarSlug). */
export function slugificarNome(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  if (base.length >= 3) return base;
  return base ? `loja-${base}` : "loja";
}
