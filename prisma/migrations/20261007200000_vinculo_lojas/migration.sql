-- Duas lojas juntas: vínculo entre contas de lojas diferentes e finalidade do
-- desafio 2FA (login x vínculo). Só cria coluna com default e tabela nova:
-- zero risco para dados existentes.

ALTER TABLE "CodigoVerificacao2FA" ADD COLUMN "finalidade" TEXT NOT NULL DEFAULT 'LOGIN';

CREATE TABLE "VinculoLoja" (
    "id" TEXT NOT NULL,
    "usuarioAId" TEXT NOT NULL,
    "usuarioBId" TEXT NOT NULL,
    "versaoA" INTEGER NOT NULL,
    "versaoB" INTEGER NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VinculoLoja_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VinculoLoja_usuarioAId_usuarioBId_key" ON "VinculoLoja"("usuarioAId", "usuarioBId");
CREATE INDEX "VinculoLoja_usuarioBId_idx" ON "VinculoLoja"("usuarioBId");

ALTER TABLE "VinculoLoja" ADD CONSTRAINT "VinculoLoja_usuarioAId_fkey" FOREIGN KEY ("usuarioAId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VinculoLoja" ADD CONSTRAINT "VinculoLoja_usuarioBId_fkey" FOREIGN KEY ("usuarioBId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
