#!/usr/bin/env bash
# backup-postgres.sh — dump comprimido do banco erp_amazon.
# Mantem 14 backups diarios + 8 semanais (domingos) em /backups.
# Backup adicional do diretorio uploads/ via tar.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_NAME="${DB_NAME:-erp_amazon}"
DB_USER="${DB_USER:-erp_amazon}"
DB_HOST="${DB_HOST:-127.0.0.1}"
APP_DIR="${APP_DIR:-/opt/erp-amazon}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/uploads"

DATE=$(date +%F_%H%M)
DAILY_FILE="${BACKUP_DIR}/daily/erp_${DATE}.sql.gz"
WEEKLY_FILE="${BACKUP_DIR}/weekly/erp_$(date +%Y-W%V).sql.gz"
UPLOADS_FILE="${BACKUP_DIR}/uploads/uploads_${DATE}.tar.gz"

echo "==> Dump diario: $DAILY_FILE"
PGPASSWORD="${PGPASSWORD:-}" pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner \
  | gzip -9 > "$DAILY_FILE"

# Aos domingos copia para weekly.
if [ "$(date +%u)" = "7" ]; then
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  echo "==> Copia weekly: $WEEKLY_FILE"
fi

# Tar dos uploads (PDFs/NFs anexados).
if [ -d "$UPLOADS_DIR" ]; then
  echo "==> Tar uploads: $UPLOADS_FILE"
  tar -czf "$UPLOADS_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
fi

echo "==> Limpeza: mantem 14 daily, 8 weekly, 14 uploads"
ls -1t "$BACKUP_DIR/daily"/*.sql.gz 2>/dev/null   | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR/weekly"/*.sql.gz 2>/dev/null  | tail -n +9  | xargs -r rm -f
ls -1t "$BACKUP_DIR/uploads"/*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "==> OK ($(du -sh "$BACKUP_DIR" | cut -f1) total)"
