-- Rate-limit persistente em Postgres. Tabela cresce devagar — limpeza
-- periodica deletando registros com resetAt < now (cron diario ou job
-- do worker).

CREATE TABLE "LoginThrottle" (
  "id"        TEXT NOT NULL,
  "chave"     TEXT NOT NULL,
  "count"     INTEGER NOT NULL DEFAULT 0,
  "resetAt"   TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoginThrottle_chave_key" ON "LoginThrottle"("chave");
CREATE INDEX "LoginThrottle_resetAt_idx" ON "LoginThrottle"("resetAt");
