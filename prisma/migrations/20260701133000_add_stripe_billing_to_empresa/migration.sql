ALTER TABLE "Empresa" ADD COLUMN "plano" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "cicloAssinatura" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "assinaturaStatus" TEXT NOT NULL DEFAULT 'PENDENTE';
ALTER TABLE "Empresa" ADD COLUMN "assinaturaAtualizadaEm" TIMESTAMP(3);
ALTER TABLE "Empresa" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "stripeCheckoutSessionId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "stripeCurrentPeriodEnd" TIMESTAMP(3);

CREATE UNIQUE INDEX "Empresa_stripeCustomerId_key" ON "Empresa"("stripeCustomerId");
CREATE UNIQUE INDEX "Empresa_stripeSubscriptionId_key" ON "Empresa"("stripeSubscriptionId");
CREATE INDEX "Empresa_assinaturaStatus_idx" ON "Empresa"("assinaturaStatus");
CREATE INDEX "Empresa_plano_idx" ON "Empresa"("plano");
