# Infra/Org DPP — implementação SEM custo (VPS Hostinger)

> Mapeia os controles de infra da DPP para ferramentas livres/open-source já
> presentes no VPS. Estado em 2026-06-03.

| Controle DPP | Solução grátis | Estado |
|---|---|---|
| #2 TLS em trânsito | Nginx + Let's Encrypt; `ssl_protocols TLSv1.2 TLSv1.3` | ✅ feito (removidos TLSv1/1.1) |
| #7 Retenção de logs ≥12m | `pm2-logrotate` (retain 400, compress, diário) | ✅ feito |
| #1/#12 Backup cifrado | `pg_dump` + `gzip` + **`gpg` AES-256**, diário, 14d/8w | ✅ feito (cron já existia; + cifragem) |
| #9 Scan de vuln (30d) | `npm audit` semanal via cron (12 relatórios) | ✅ feito |
| #6 Proteção de rede (brute-force) | **fail2ban** (jail sshd ativo) | ✅ ativo |
| #6 Firewall | ⚠️ `ufw` **NÃO** funciona aqui (conflita com iptables do Docker — derruba IPv4). Usar firewall do provedor (Hostinger) OU `ufw-docker`. | ⚠️ pendente (provedor) |
| #5 MFA forte | TOTP no app (a implementar) + autenticador grátis | 🟡 pendente (código) |
| #3 KMS / rotação anual | Chave em arquivo root-600 + runbook de rotação (`docs/secrets-rotation.md`) | 🟡 manual |

## O que foi configurado (comandos de referência)

### TLS (nginx)
`/etc/nginx/nginx.conf` → `ssl_protocols TLSv1.2 TLSv1.3;` → `nginx -t && systemctl reload nginx`.

### Logs (pm2-logrotate)
```
pm2 set pm2-logrotate:retain 400
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
```

### Backup cifrado
- Script: `deploy/backup-postgres.sh` (cron erp 3am). Cifra com gpg se existir
  `/home/erp/.backup-gpg-pass`.
- **AÇÃO DO DONO:** copie a passphrase (`/home/erp/.backup-gpg-pass`) para um
  lugar **offline** (gerenciador de senhas). Sem ela os backups são irrecuperáveis.
- Restore: `gpg --batch --passphrase-file /home/erp/.backup-gpg-pass -d arquivo.sql.gz.gpg | gunzip | psql "$DATABASE_URL"`.
- ⚠️ Backups ficam no MESMO servidor (`/backups`). Para DPP ideal: copiar offsite
  (rclone p/ um storage grátis, ou download periódico). Sem custo: download manual.

### Scan de vulnerabilidade
- Cron erp: `npm audit --omit=dev --json` semanal → `/home/erp/npm-audit-*.json`.
- Pentest inicial: `SECURITY-AUDIT-2026-06.md`. Repetir anualmente.

### Brute-force
- `fail2ban` ativo (jail `sshd`). Confirme que cobre a porta 2222.

## Pendências do dono (sem custo, mas exigem ação)
1. Copiar a passphrase de backup offline.
2. Habilitar **MFA** (TOTP) na própria conta quando o recurso entrar no app.
3. Definir firewall pelo painel da Hostinger (já que ufw conflita com Docker).
4. Rotação anual da `CONFIG_ENCRYPTION_KEY` (ver `docs/secrets-rotation.md`).
5. Revisar o questionário DPP (`questionario-seguranca-dpp.md`) e marcar estes itens.
