#!/usr/bin/env bash
# watchdog.sh — verifica saude do worker e reinicia se travado.
# Roda via cron a cada 5min. Considera o worker morto se:
#  - processo erp-worker nao esta online no PM2; OU
#  - heartbeat (gravado em ConfiguracaoSistema) > 5min.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/erp-amazon}"
HEARTBEAT_LIMIT_SEC="${HEARTBEAT_LIMIT_SEC:-300}"

log() { echo "[$(date -Iseconds)] watchdog: $*"; }

status=$(pm2 jlist 2>/dev/null | node -e "
  const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const w = data.find(p => p.name === 'erp-worker');
  if (!w) { console.log('MISSING'); process.exit(0); }
  console.log(w.pm2_env.status);
" 2>/dev/null || echo "ERROR")

if [ "$status" != "online" ]; then
  log "worker status=$status — restart"
  pm2 restart erp-worker || pm2 start "$APP_DIR/deploy/ecosystem.config.js" --only erp-worker
  exit 0
fi

# Checa heartbeat (gravado pelo proprio worker).
heartbeat=$(curl -fsS "http://127.0.0.1:3000/api/health" 2>/dev/null \
  | node -e "
    let s=''; process.stdin.on('data', c => s+=c);
    process.stdin.on('end', () => {
      try { const j=JSON.parse(s); console.log(j.worker?.lastHeartbeatAt ?? '');}
      catch { console.log(''); }
    });
  " || echo "")

if [ -z "$heartbeat" ]; then
  log "heartbeat ausente — sem dados, segue"
  exit 0
fi

age=$(( $(date +%s) - $(date -d "$heartbeat" +%s 2>/dev/null || echo 0) ))
if [ "$age" -gt "$HEARTBEAT_LIMIT_SEC" ]; then
  log "heartbeat $age s atras (limite ${HEARTBEAT_LIMIT_SEC}s) — restart"
  pm2 restart erp-worker
fi
