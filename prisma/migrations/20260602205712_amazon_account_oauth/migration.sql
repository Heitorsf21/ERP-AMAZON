-- F02: credenciais OAuth por seller no AmazonAccount (aditivo, não-destrutivo).
ALTER TABLE "AmazonAccount" ADD COLUMN "refreshTokenEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "accessTokenEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "AmazonAccount" ADD COLUMN "lwaScopes" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "conectadoEm" TIMESTAMP(3);
