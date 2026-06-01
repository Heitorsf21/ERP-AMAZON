-- Usuario: email global -> composto por empresa + empresaId NOT NULL.
-- Seguro: backfill ja concluido (todos os Usuario tem empresaId='mundofs').
DROP INDEX IF EXISTS "Usuario_email_key";
ALTER TABLE "Usuario" ALTER COLUMN "empresaId" SET NOT NULL;
CREATE UNIQUE INDEX "Usuario_empresaId_email_key" ON "Usuario"("empresaId", "email");
CREATE INDEX IF NOT EXISTS "Usuario_email_idx" ON "Usuario"("email");

-- Convite de admin (set-password): token hasheado, single-use, expira.
CREATE TABLE "ConviteUsuario" (
  "id"        TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usadoEm"   TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConviteUsuario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConviteUsuario_tokenHash_key" ON "ConviteUsuario"("tokenHash");
CREATE INDEX "ConviteUsuario_usuarioId_idx" ON "ConviteUsuario"("usuarioId");
CREATE INDEX "ConviteUsuario_expiresAt_idx" ON "ConviteUsuario"("expiresAt");
ALTER TABLE "ConviteUsuario" ADD CONSTRAINT "ConviteUsuario_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trilha de auditoria da camada plataforma (superadmin).
CREATE TABLE "AuditPlataforma" (
  "id"                  TEXT NOT NULL,
  "plataformaUsuarioId" TEXT,
  "acao"                TEXT NOT NULL,
  "empresaIdAlvo"       TEXT,
  "metadata"            TEXT,
  "ip"                  TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditPlataforma_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditPlataforma_plataformaUsuarioId_idx" ON "AuditPlataforma"("plataformaUsuarioId");
CREATE INDEX "AuditPlataforma_empresaIdAlvo_idx" ON "AuditPlataforma"("empresaIdAlvo");
CREATE INDEX "AuditPlataforma_createdAt_idx" ON "AuditPlataforma"("createdAt");
