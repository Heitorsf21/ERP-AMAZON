#!/usr/bin/env bash
# watchdog.sh — verifica saude do worker e reinicia se travado.
# Roda via cron a cada 5min. Considera o worker morto se:
#  - processo erp-worker nao esta online no PM2; OU
#  - heartbeat (gravado em ConfiguracaoSistema) > 5min.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/erp-amazon}"
HEARTBEAT_LIMIT_SEC="${HEARTBEAT_LIMIT_SEC:-300}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

# Token interno para receber detalhes do /api/health sem sessão.
# Lido do .env do app se INTERNAL_HEALTH_TOKEN não estiver no ambiente.
if [ -z "${INTERNAL_HEALTH_TOKEN:-}" ] && [ -f "$APP_DIR/.env" ]; then
  # shellcheck disable=SC1090
  INTERNAL_HEALTH_TOKEN="$(grep -E '^INTERNAL_HEALTH_TOKEN=' "$APP_DIR/.env" 2>/dev/null \
    | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi

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
# /api/health só devolve worker.lastHeartbeatAt para sessão ADMIN ou com header
# X-Internal-Health-Token batendo com $INTERNAL_HEALTH_TOKEN.
curl_args=(-fsS)
if [ -n "${INTERNAL_HEALTH_TOKEN:-}" ]; then
  curl_args+=(-H "X-Internal-Health-Token: ${INTERNAL_HEALTH_TOKEN}")
fi

heartbeat=$(curl "${curl_args[@]}" "$HEALTH_URL" 2>/dev/null \
  | node -e "
    let s=''; process.stdin.on('data', c => s+=c);
    process.stdin.on('end', () => {
      try { const j=JSON.parse(s); console.log(j.worker?.lastHeartbeatAt ?? '');}
      catch { console.log(''); }
    });
  " || echo "")

if [ -z "$heartbeat" ]; then
  if [ -z "${INTERNAL_HEALTH_TOKEN:-}" ]; then
    log "heartbeat ausente e INTERNAL_HEALTH_TOKEN não definido — configurar token no .env"
  else
    log "heartbeat ausente — sem dados, segue"
  fi
  exit 0
fi

age=$(( $(date +%s) - $(date -d "$heartbeat" +%s 2>/dev/null || echo 0) ))
if [ "$age" -gt "$HEARTBEAT_LIMIT_SEC" ]; then
  log "heartbeat $age s atras (limite ${HEARTBEAT_LIMIT_SEC}s) — restart"
  pm2 restart erp-worker
fi
