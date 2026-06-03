#!/usr/bin/env bash
# backup-postgres.sh — dump comprimido do banco erp_amazon.
# Mantem 14 backups diarios + 8 semanais (domingos) em /backups.
# Backup adicional do diretorio uploads/ via tar.
#
# DPP #1 (cripto em repouso): se houver um arquivo de passphrase
# (BACKUP_GPG_PASSPHRASE_FILE, default /home/erp/.backup-gpg-pass), os dumps sao
# CIFRADOS com gpg AES-256 (saida .gpg). Sem o arquivo, mantem o comportamento
# antigo (apenas gzip) — backward-compatible. GUARDE a passphrase OFFLINE: sem
# ela os backups cifrados sao irrecuperaveis.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_NAME="${DB_NAME:-erp_amazon}"
DB_USER="${DB_USER:-erp_amazon}"
DB_HOST="${DB_HOST:-127.0.0.1}"
APP_DIR="${APP_DIR:-/opt/erp-amazon}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/uploads}"
GPG_PASS_FILE="${BACKUP_GPG_PASSPHRASE_FILE:-/home/erp/.backup-gpg-pass}"

ENC=0
EXT=""
if [ -s "$GPG_PASS_FILE" ]; then
  ENC=1
  EXT=".gpg"
fi

# Cifra stdin -> arquivo (gpg simetrico AES-256) ou apenas copia quando ENC=0.
encrypt_to() {
  local out="$1"
  if [ "$ENC" = "1" ]; then
    gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase-file "$GPG_PASS_FILE" -o "$out"
  else
    cat > "$out"
  fi
}

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/uploads"

DATE=$(date +%F_%H%M)
DAILY_FILE="${BACKUP_DIR}/daily/erp_${DATE}.sql.gz${EXT}"
WEEKLY_FILE="${BACKUP_DIR}/weekly/erp_$(date +%Y-W%V).sql.gz${EXT}"
UPLOADS_FILE="${BACKUP_DIR}/uploads/uploads_${DATE}.tar.gz${EXT}"

echo "==> Dump diario ($([ "$ENC" = 1 ] && echo cifrado || echo gzip)): $DAILY_FILE"
PGPASSWORD="${PGPASSWORD:-}" pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner \
  | gzip -9 | encrypt_to "$DAILY_FILE"

# Aos domingos copia para weekly (mantem cifragem).
if [ "$(date +%u)" = "7" ]; then
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  echo "==> Copia weekly: $WEEKLY_FILE"
fi

# Tar dos uploads (PDFs/NFs anexados).
if [ -d "$UPLOADS_DIR" ]; then
  echo "==> Tar uploads: $UPLOADS_FILE"
  tar -czf - -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" | encrypt_to "$UPLOADS_FILE"
fi

echo "==> Limpeza: mantem 14 daily, 8 weekly, 14 uploads"
ls -1t "$BACKUP_DIR/daily"/*.sql.gz* 2>/dev/null   | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR/weekly"/*.sql.gz* 2>/dev/null  | tail -n +9  | xargs -r rm -f
ls -1t "$BACKUP_DIR/uploads"/*.tar.gz* 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "==> OK ($(du -sh "$BACKUP_DIR" | cut -f1) total)"
