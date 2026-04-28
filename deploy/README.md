# Deploy — VPS Hostinger (Ubuntu 22.04+)

Scripts e configs para colocar o ERP rodando 24/7 numa VPS própria.
Tudo aqui é open source / sem custo recorrente.

## Componentes

- **Nginx** — reverse proxy `:443 → localhost:3000` com SSL gratuito (Let's Encrypt).
- **PM2** — gerencia 2 processos: `erp-web` (Next.js) e `erp-worker` (daemon SP-API).
- **systemd unit** (`pm2-erp.service`) — sobe os processos no boot.
- **PostgreSQL 16** — banco local, sem custo, latência mínima.
- **cron Linux** — backup diário (03h) e watchdog do worker (a cada 5min).

## Sequência de instalação

```bash
# 1. Provisionar
sudo bash deploy/install-server.sh

# 2. Criar role + database (defina senha antes)
export PG_ERP_PASSWORD='senha_forte_aqui'
sudo -E -u postgres psql -f deploy/postgres-setup.sql

# 3. Clonar app + dependências
sudo -u erp git clone <REPO> /opt/erp-amazon
cd /opt/erp-amazon
sudo -u erp npm ci

# 4. .env
sudo -u erp cp .env.example .env
sudo -u erp $EDITOR .env
sudo chmod 600 .env
# DATABASE_URL="postgresql://erp_amazon:senha_forte_aqui@localhost:5432/erp_amazon?schema=public"
# CONFIG_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
# INTERNAL_HEALTH_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 5. Migrations + build
# Em produção SEMPRE usar os scripts :pg para apontar explicitamente o schema
# Postgres (prisma/schema.postgresql.prisma). Os scripts sem sufixo usam o
# schema SQLite default e não devem rodar na VPS.
sudo -u erp npm run prisma:generate:pg
sudo -u erp npm run prisma:migrate:deploy:pg
sudo -u erp npm run build

# 6. Migrar dados do SQLite (rodar UMA VEZ se vier de instalação SQLite)
# sudo -u erp SQLITE_URL="file:./prisma/dev.db" npm run migrate:sqlite-to-postgres

# 7. Nginx + SSL
sudo cp deploy/nginx-erp.conf /etc/nginx/sites-available/erp.conf
sudo sed -i 's/SEU_DOMINIO/seu-dominio.com/g' /etc/nginx/sites-available/erp.conf
sudo ln -sf /etc/nginx/sites-available/erp.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seu-dominio.com

# 8. PM2 + systemd
sudo -u erp pm2 start /opt/erp-amazon/deploy/ecosystem.config.js
sudo -u erp pm2 save
sudo cp deploy/systemd/pm2-erp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pm2-erp

# 9. Cron (backup + watchdog)
sudo -u erp crontab deploy/crontab.example
```

## Operações

| Comando | O que faz |
|---|---|
| `pm2 status` | Lista processos vivos |
| `pm2 logs erp-web --lines 100` | Logs do Next.js |
| `pm2 logs erp-worker --lines 100` | Logs do worker |
| `pm2 restart erp-worker` | Reinicia o worker |
| `pm2 reload erp-web` | Zero-downtime reload do app |
| `curl https://seu-dominio.com/api/health` | Health check |
| `bash deploy/backup-postgres.sh` | Backup imediato |
| `bash deploy/restore-check.sh` | Restaura último backup num DB temporário e valida (rodar 1x por mês via cron) |
| `tail -f /var/log/erp-backup.log` | Acompanha backup |
| `tail -f /var/log/erp-watchdog.log` | Acompanha watchdog |
| `curl -H "X-Internal-Health-Token: $TOK" http://127.0.0.1:3000/api/health` | Health detalhado (worker heartbeat, queue, quota) |

## Atualização (deploy de uma nova versão)

```bash
sudo -u erp bash -c '
  cd /opt/erp-amazon &&
  git pull --ff-only &&
  npm ci &&
  npm run prisma:generate:pg &&
  npm run prisma:migrate:deploy:pg &&
  npm run build &&
  pm2 reload erp-web &&
  pm2 restart erp-worker
'
```
