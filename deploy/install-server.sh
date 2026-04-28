#!/usr/bin/env bash
# install-server.sh — Provisão inicial da VPS Hostinger (Ubuntu 22.04+)
# Roda como root. Idempotente: pode rodar várias vezes sem quebrar.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/erp-amazon}"
APP_USER="${APP_USER:-erp}"
PG_VERSION="${PG_VERSION:-16}"

echo "==> Atualizando apt"
apt-get update -y
apt-get upgrade -y

echo "==> Pacotes base"
apt-get install -y curl git build-essential ca-certificates gnupg lsb-release \
    nginx ufw unzip cron rsync

echo "==> Node.js 20 (NodeSource)"
if ! command -v node >/dev/null || ! node -v | grep -q "^v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> PM2"
if ! command -v pm2 >/dev/null; then
  npm install -g pm2@latest
fi

echo "==> pm2-logrotate (rotaciona ~/.pm2/logs para não estourar disco)"
if ! pm2 list 2>/dev/null | grep -q "pm2-logrotate"; then
  pm2 install pm2-logrotate
fi
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

echo "==> tsx (executor TypeScript do worker)"
if ! command -v tsx >/dev/null; then
  npm install -g tsx
fi

echo "==> PostgreSQL ${PG_VERSION}"
if ! command -v psql >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}"
  systemctl enable --now postgresql
fi

echo "==> Certbot (Let's Encrypt) via snap"
if ! command -v certbot >/dev/null; then
  apt-get install -y snapd
  snap install core
  snap refresh core
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
fi

echo "==> Usuario ${APP_USER}"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

echo "==> Diretorios"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" /backups
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/uploads"

echo "==> Firewall (libera 22, 80, 443)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo
echo "==> Pronto. Proximos passos:"
echo "  1. sudo -u postgres psql -f ${APP_DIR}/deploy/postgres-setup.sql"
echo "  2. su - ${APP_USER} -c 'git clone <REPO> ${APP_DIR} && cd ${APP_DIR} && npm ci'"
echo "  3. cp ${APP_DIR}/.env.example ${APP_DIR}/.env  (editar valores)"
echo "  4. cd ${APP_DIR} && npm run prisma:generate:pg && npm run prisma:migrate:deploy:pg"
echo "  5. cd ${APP_DIR} && npm run build"
echo "  6. cp ${APP_DIR}/deploy/nginx-erp.conf /etc/nginx/sites-available/erp.conf"
echo "     ln -s /etc/nginx/sites-available/erp.conf /etc/nginx/sites-enabled/"
echo "     nginx -t && systemctl reload nginx"
echo "  7. certbot --nginx -d SEU_DOMINIO"
echo "  8. su - ${APP_USER} -c 'cd ${APP_DIR} && pm2 start deploy/ecosystem.config.js && pm2 save'"
echo "  9. cp ${APP_DIR}/deploy/systemd/pm2-erp.service /etc/systemd/system/"
echo "     systemctl daemon-reload && systemctl enable --now pm2-erp"
echo " 10. crontab -e (como ${APP_USER}) e adicione as linhas em deploy/crontab.example"
