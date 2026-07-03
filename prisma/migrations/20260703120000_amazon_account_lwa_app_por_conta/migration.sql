-- App LWA próprio por conta (self-authorization — caso UDN). Aditivo, não-destrutivo.
-- NULL = conta continua usando o app global (env/ConfiguracaoSistema).
ALTER TABLE "AmazonAccount" ADD COLUMN "lwaClientIdEnc" TEXT;
ALTER TABLE "AmazonAccount" ADD COLUMN "lwaClientSecretEnc" TEXT;
