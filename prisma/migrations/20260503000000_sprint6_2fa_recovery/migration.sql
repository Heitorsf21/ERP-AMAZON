-- AlterTable Usuario: adiciona campos 2FA
ALTER TABLE "Usuario" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Usuario" ADD COLUMN "twoFactorMethod" TEXT;

-- CreateTable TokenRecuperacaoSenha
CREATE TABLE "TokenRecuperacaoSenha" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRecuperacaoSenha_pkey" PRIMARY KEY ("id")
);

-- CreateTable CodigoVerificacao2FA
CREATE TABLE "CodigoVerificacao2FA" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoVerificacao2FA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenRecuperacaoSenha_tokenHash_key" ON "TokenRecuperacaoSenha"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenRecuperacaoSenha_usuarioId_idx" ON "TokenRecuperacaoSenha"("usuarioId");

-- CreateIndex
CREATE INDEX "TokenRecuperacaoSenha_expiresAt_idx" ON "TokenRecuperacaoSenha"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoVerificacao2FA_challengeId_key" ON "CodigoVerificacao2FA"("challengeId");

-- CreateIndex
CREATE INDEX "CodigoVerificacao2FA_usuarioId_idx" ON "CodigoVerificacao2FA"("usuarioId");

-- CreateIndex
CREATE INDEX "CodigoVerificacao2FA_challengeId_idx" ON "CodigoVerificacao2FA"("challengeId");

-- CreateIndex
CREATE INDEX "CodigoVerificacao2FA_expiresAt_idx" ON "CodigoVerificacao2FA"("expiresAt");

-- AddForeignKey
ALTER TABLE "TokenRecuperacaoSenha" ADD CONSTRAINT "TokenRecuperacaoSenha_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoVerificacao2FA" ADD CONSTRAINT "CodigoVerificacao2FA_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
