-- Coluna usada para revogar sessoes server-side: incrementada em troca de senha
-- e em "encerrar todas as sessoes". Tokens carregam o `v` no payload e o
-- getSession compara contra o atual. Default 0 garante seamless para usuarios
-- existentes (cookies antigos sem `v` ganham graceful pass).

ALTER TABLE "Usuario"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
