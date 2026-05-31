-- Backfill idempotente: empresaId NULL -> 'mundofs' em TODAS as tabelas com a
-- coluna. Single-tenant: todo NULL pertence a mundofs. Transacional: se ao final
-- restar qualquer NULL, RAISE EXCEPTION faz ROLLBACK de tudo (zero estado parcial).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE r record; updated bigint; total_updated bigint := 0;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE column_name = 'empresaId' AND table_schema = 'public'
           ORDER BY table_name LOOP
    EXECUTE format('UPDATE %I SET "empresaId" = ''mundofs'' WHERE "empresaId" IS NULL', r.table_name);
    GET DIAGNOSTICS updated = ROW_COUNT;
    total_updated := total_updated + updated;
    IF updated > 0 THEN
      RAISE NOTICE 'backfill %: % linhas', r.table_name, updated;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL backfill: % linhas', total_updated;
END $$;

-- Validacao: zero NULL em qualquer tabela com a coluna; senao aborta (rollback).
DO $$
DECLARE r record; n bigint; restantes bigint := 0;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE column_name = 'empresaId' AND table_schema = 'public' LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "empresaId" IS NULL', r.table_name) INTO n;
    restantes := restantes + n;
  END LOOP;
  IF restantes > 0 THEN
    RAISE EXCEPTION 'ABORT: ainda existem % linhas com empresaId NULL', restantes;
  END IF;
  RAISE NOTICE 'VALIDACAO OK: zero NULL em todas as tabelas com empresaId';
END $$;

COMMIT;
