-- Aplica NOT NULL em empresaId nas tabelas TENANT (backstop de integridade).
-- Exclui Usuario/AmazonAccount (FK ON DELETE SET NULL precisa de nullable) e
-- AuditLog (gravado com empresaId NULL em fluxos pre-contexto: login/2FA/recovery).
-- Transacional: qualquer falha -> ROLLBACK total. lock_timeout evita travar o banco.
\set ON_ERROR_STOP on
SET lock_timeout = '8s';
SET statement_timeout = '120s';
BEGIN;

DO $$
DECLARE
  r record;
  excluidas text[] := ARRAY['Usuario','AmazonAccount','AuditLog'];
  aplicadas int := 0;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE column_name = 'empresaId' AND table_schema = 'public'
             AND table_name <> ALL (excluidas)
           ORDER BY table_name LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "empresaId" SET NOT NULL', r.table_name);
    aplicadas := aplicadas + 1;
  END LOOP;
  RAISE NOTICE 'NOT NULL aplicado em % tabelas tenant', aplicadas;
END $$;

-- Sanity: nenhuma das tabelas-alvo pode ter ficado de fora por engano.
DO $$
DECLARE faltando int;
BEGIN
  SELECT count(*) INTO faltando
  FROM information_schema.columns
  WHERE column_name = 'empresaId' AND table_schema = 'public'
    AND is_nullable = 'YES'
    AND table_name <> ALL (ARRAY['Usuario','AmazonAccount','AuditLog']);
  IF faltando > 0 THEN
    RAISE EXCEPTION 'ABORT: % tabelas tenant ainda nullable', faltando;
  END IF;
  RAISE NOTICE 'VALIDACAO OK: todas as tabelas tenant agora NOT NULL';
END $$;

COMMIT;
