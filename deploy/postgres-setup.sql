-- postgres-setup.sql — cria role + database para o ERP.
-- Rodar como: sudo -u postgres psql -f deploy/postgres-setup.sql
-- Senha do role vem da var de ambiente PG_ERP_PASSWORD (export antes ou ajuste abaixo).

\set erp_password `echo "$PG_ERP_PASSWORD"`

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_amazon') THEN
    EXECUTE format('CREATE ROLE erp_amazon WITH LOGIN PASSWORD %L', :'erp_password');
  END IF;
END$$;

SELECT 'CREATE DATABASE erp_amazon OWNER erp_amazon ENCODING UTF8'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'erp_amazon')\gexec

GRANT ALL PRIVILEGES ON DATABASE erp_amazon TO erp_amazon;

-- Conecta no novo banco para conceder permissões em schemas.
\c erp_amazon
GRANT ALL ON SCHEMA public TO erp_amazon;
ALTER SCHEMA public OWNER TO erp_amazon;
