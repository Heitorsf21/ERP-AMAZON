-- Atlas mobile: aparelhos inscritos para push e histórico/idempotência dos avisos.
-- Só cria tabelas novas: zero risco para dados existentes.

CREATE TABLE "PushDispositivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "apelido" TEXT,
    "receberVendas" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "falhasConsecutivas" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushDispositivo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDispositivo_empresaId_endpoint_key" ON "PushDispositivo"("empresaId", "endpoint");
CREATE INDEX "PushDispositivo_empresaId_ativo_idx" ON "PushDispositivo"("empresaId", "ativo");
CREATE INDEX "PushDispositivo_usuarioId_idx" ON "PushDispositivo"("usuarioId");
CREATE INDEX "PushDispositivo_endpoint_idx" ON "PushDispositivo"("endpoint");

CREATE TABLE "PushEnvio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "tipo" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "enviadosOk" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),
    CONSTRAINT "PushEnvio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushEnvio_empresaId_dedupeKey_key" ON "PushEnvio"("empresaId", "dedupeKey");
CREATE INDEX "PushEnvio_criadoEm_idx" ON "PushEnvio"("criadoEm");
