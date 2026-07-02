export const BILLING_PLAN_IDS = ["starter", "pro", "scale"] as const;
export const BILLING_PERIODS = ["mensal", "trimestral", "semestral", "anual"] as const;

export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number];
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

type PlanConfig = {
  label: string;
  priceEnv: Record<BillingPeriod, string>;
};

export const BILLING_PLANS: Record<BillingPlanId, PlanConfig> = {
  starter: {
    label: "Starter",
    priceEnv: {
      mensal: "STRIPE_PRICE_STARTER_MENSAL",
      trimestral: "STRIPE_PRICE_STARTER_TRIMESTRAL",
      semestral: "STRIPE_PRICE_STARTER_SEMESTRAL",
      anual: "STRIPE_PRICE_STARTER_ANUAL",
    },
  },
  pro: {
    label: "Pro",
    priceEnv: {
      mensal: "STRIPE_PRICE_PRO_MENSAL",
      trimestral: "STRIPE_PRICE_PRO_TRIMESTRAL",
      semestral: "STRIPE_PRICE_PRO_SEMESTRAL",
      anual: "STRIPE_PRICE_PRO_ANUAL",
    },
  },
  scale: {
    label: "Scale",
    priceEnv: {
      mensal: "STRIPE_PRICE_SCALE_MENSAL",
      trimestral: "STRIPE_PRICE_SCALE_TRIMESTRAL",
      semestral: "STRIPE_PRICE_SCALE_SEMESTRAL",
      anual: "STRIPE_PRICE_SCALE_ANUAL",
    },
  },
};

export function parseBillingPlanId(value: unknown): BillingPlanId {
  if (typeof value === "string" && BILLING_PLAN_IDS.includes(value as BillingPlanId)) {
    return value as BillingPlanId;
  }
  throw new Error("plano inválido");
}

export function parseBillingPeriod(value: unknown): BillingPeriod {
  if (typeof value === "string" && BILLING_PERIODS.includes(value as BillingPeriod)) {
    return value as BillingPeriod;
  }
  throw new Error("período inválido");
}

export function getStripePriceId(planId: BillingPlanId, period: BillingPeriod): string {
  const envName = BILLING_PLANS[planId].priceEnv[period];
  const priceId = process.env[envName]?.trim();
  if (!priceId) {
    throw new Error(`${envName} não configurado`);
  }
  return priceId;
}
