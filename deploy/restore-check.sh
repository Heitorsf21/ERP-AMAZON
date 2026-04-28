#!/usr/bin/env bash
# restore-check.sh — valida o backup mensal restaurando-o num banco temporário.
# Uso: bash deploy/restore-check.sh [/caminho/para/backup.sql.gz]
# Sem argumento, pega o backup diário mais recente em $BACKUP_DIR/daily.
#
# O que faz:
#   1. cria role + database temporários (erp_restore_check / erp_restore_check)
#   2. restaura o dump nesse database
#   3. valida que pelo menos uma tabela conhecida foi restaurada
#   4. derruba o database e a role no fim, mesmo em erro
#
# Requer pg_restore + psql + gunzip. Roda como usuário com acesso ao Postgres
# local (geralmente o usuário 'erp', via PGPASSWORD ou .pgpass).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ADMIN_USER="${ADMIN_USER:-postgres}"
TMP_DB="erp_restore_check_$(date +%s)"
TMP_USER="erp_restore_check"

log() { echo "[$(date -Iseconds)] restore-check: $*"; }

cleanup() {
  log "limpando $TMP_DB / $TMP_USER"
  sudo -u "$ADMIN_USER" psql -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS \"$TMP_DB\";" >/dev/null 2>&1 || true
  sudo -u "$ADMIN_USER" psql -v ON_ERROR_STOP=0 -c "DROP ROLE IF EXISTS \"$TMP_USER\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 1. Backup a usar
DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP=$(ls -1t "$BACKUP_DIR/daily"/*.sql.gz 2>/dev/null | head -n1 || true)
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  log "ERRO: backup não encontrado (passe caminho ou cheque $BACKUP_DIR/daily)"
  exit 1
fi
log "backup: $DUMP"

# 2. Cria role + database temporários
log "criando role + database temporários"
sudo -u "$ADMIN_USER" psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE "$TMP_USER" WITH LOGIN PASSWORD 'restore_check';
CREATE DATABASE "$TMP_DB" OWNER "$TMP_USER";
SQL

# 3. Restaura
log "restaurando dump (pode levar alguns minutos)"
PGPASSWORD=restore_check gunzip -c "$DUMP" \
  | psql -h "$DB_HOST" -p "$DB_PORT" -U "$TMP_USER" -d "$TMP_DB" \
      -v ON_ERROR_STOP=1 >/dev/null

# 4. Validação básica: precisa existir pelo menos a tabela Usuario.
log "validando tabelas essenciais"
PGPASSWORD=restore_check psql -h "$DB_HOST" -p "$DB_PORT" -U "$TMP_USER" \
  -d "$TMP_DB" -At -c "SELECT to_regclass('public.\"Usuario\"');" \
  | grep -q "Usuario" \
  || { log "FALHOU: tabela Usuario não encontrada após restore"; exit 1; }

count=$(PGPASSWORD=restore_check psql -h "$DB_HOST" -p "$DB_PORT" \
  -U "$TMP_USER" -d "$TMP_DB" -At \
  -c 'SELECT COUNT(*) FROM "Usuario";')
log "restore OK — Usuario.count=$count"
