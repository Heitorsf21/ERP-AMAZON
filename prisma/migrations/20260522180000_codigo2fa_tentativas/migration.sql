-- Adiciona contador de tentativas no challenge 2FA para bloquear brute-force.
-- Cada POST em /api/auth/2fa/verificar com codigo errado incrementa este campo;
-- ao atingir o limite, o handler marca usadoEm e o challenge fica invalidado.

ALTER TABLE "CodigoVerificacao2FA"
  ADD COLUMN "tentativas" INTEGER NOT NULL DEFAULT 0;
