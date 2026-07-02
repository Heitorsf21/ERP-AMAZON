import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = secretKey
  ? new Stripe(secretKey, {
      apiVersion: "2026-06-24.dahlia",
      typescript: true,
    })
  : null;

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY não configurada");
  }
  return stripe;
}
