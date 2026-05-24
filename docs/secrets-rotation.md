# Runbook — Rotação de secrets

Documenta como rotacionar cada secret crítico do Atlas Seller sem quebrar produção. Última revisão: 2026-05-23.

## Inventário de secrets

| Env var | Função | Onde lê | Cadência sugerida | Quem revoga sessões? |
|---|---|---|---|---|
| `SESSION_SECRET` | HMAC do cookie de sessão | [src/lib/session.ts](../src/lib/session.ts) | 12 meses **ou** incidente | sim — todos os logados |
| `CONFIG_ENCRYPTION_KEY` | AES-256-GCM em [ConfiguracaoSistema] | [src/lib/crypto.ts](../src/lib/crypto.ts) | só em incidente | não — mas inutiliza valores criptografados |
| `CRON_SECRET` | Bearer dos endpoints `/api/amazon/cron-*` | [src/lib/cron-auth.ts](../src/lib/cron-auth.ts) | 6 meses | não |
| `INTERNAL_HEALTH_TOKEN` | Token do watchdog em `/api/health` | [src/app/api/health/route.ts](../src/app/api/health/route.ts) | 6 meses | não |
| `AMAZON_LWA_CLIENT_ID` / `AMAZON_LWA_CLIENT_SECRET` / `AMAZON_LWA_REFRESH_TOKEN` | SP-API auth | [src/lib/amazon-sp-api.ts](../src/lib/amazon-sp-api.ts) | só em incidente / rotação Amazon | não |
| `AMAZON_ADS_CLIENT_ID` / `AMAZON_ADS_CLIENT_SECRET` / `AMAZON_ADS_REFRESH_TOKEN` | Ads API | módulo `amazon/ads-service` | só em incidente | não |
| `OPENAI_API_KEY` | Extração de NFs e boletos | [contas/nf-extract](../src/app/api/contas/nf-extract/route.ts), [documentos-financeiros](../src/modules/documentos-financeiros/service.ts) | 6 meses | não |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SQS consumer (Marketing Stream) | [src/lib/amazon-sqs.ts](../src/lib/amazon-sqs.ts) | 90 dias (IAM best practice) | não |
| SMTP_USER / SMTP_PASS | Envio de e-mails (recuperação + 2FA) | [src/lib/email.ts](../src/lib/email.ts) | 12 meses | não |
| `gmail_client_secret` / `gmail_refresh_token` (no DB, criptografado) | OAuth Gmail | [src/lib/gmail.ts](../src/lib/gmail.ts) | só em incidente | não |
| Postgres `erp_amazon` password | Acesso DB | `.env` `DATABASE_URL` | 12 meses (após least-privilege split em `docs/postgres-roles.md`) | não |

---

## Procedimento padrão

Para QUALQUER rotação:

1. **Anunciar** a janela em #ops (se houver). A maioria das rotações é zero-downtime, mas a melhor hora é fora do horário comercial.
2. **Backup do `.env`** atual:
   ```bash
   ssh erp-vps
   sudo -u erp -i
   cp /opt/erp-amazon/.env /opt/erp-amazon/.env.bak.$(date +%Y%m%d-%H%M)
   ```
3. **Gerar novo valor** (instruções por secret abaixo).
4. **Editar `.env`** com o novo valor. NÃO commitar.
5. **Reload com env atualizado**:
   ```bash
   pm2 reload erp-web --update-env
   pm2 reload erp-worker --update-env
   pm2 reload erp-sqs-consumer --update-env
   ```
6. **Verificar `/api/health`** retorna `ok: true`.
7. **Smoke test** específico (login, sync Amazon, etc. — depende do secret).
8. **Revogar o valor antigo** no provedor externo (se aplicável).
9. **Apagar `.env.bak`** depois de 7 dias se tudo correu bem.

---

## Por secret

### `SESSION_SECRET` (rotação routine ou incidente)

**Efeito:** invalida TODAS as sessões ativas (cookies antigos não verificam contra a nova HMAC). Todos os usuários precisam fazer login de novo.

```bash
# 1. Gerar novo valor (mínimo 32 chars; usamos 48)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 2. Editar .env trocando SESSION_SECRET=...

# 3. Reload (todos os processos)
pm2 reload erp-web erp-worker erp-sqs-consumer --update-env
```

Comunicar usuários: vai pedir login de novo na próxima visita.

### `CONFIG_ENCRYPTION_KEY` (apenas em incidente)

**Efeito CRÍTICO:** inutiliza TODOS os valores criptografados em `ConfiguracaoSistema` (LWA secret/refresh, Gmail OAuth, etc.). É necessário reconfigurar Amazon SP-API + Ads + Gmail manualmente.

Procedimento:

1. ANTES de trocar a chave: extrair credenciais legíveis em PSQL com chave ANTIGA via um script ad-hoc.
2. Trocar a chave no `.env`.
3. Reescrever credenciais via UI (`/configuracoes`) — o `saveAmazonConfig` re-criptografa com a chave nova.

**Recomendação:** evitar rotação. Trocar apenas se houver suspeita de comprometimento.

### `CRON_SECRET`

**Efeito:** cron Linux passa a falhar até atualizar o crontab.

```bash
# 1. Gerar
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Editar .env + crontab (se cron passa o secret no header)
crontab -e   # editar Authorization Bearer

# 3. Reload web
pm2 reload erp-web --update-env
```

### `INTERNAL_HEALTH_TOKEN`

**Efeito:** watchdog para de receber detalhes em `/api/health` (mas `ok: true/false` continua público).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# editar .env e deploy/watchdog.sh (se hard-coded — verificar)
pm2 reload erp-web --update-env
```

### Amazon LWA (SP-API + Ads)

**Efeito:** se trocar `refresh_token`, o worker para de sincronizar até reconfigurar.

Procedimento:
1. Acessar Seller Central → Apps → `App registrada` → "Revoke" no token atual (opcional, se incidente).
2. Re-autorizar gerando novo `refresh_token` via OAuth (UI em `/amazon/config`).
3. O `saveAmazonConfig` salva o novo valor criptografado em `ConfiguracaoSistema`.
4. Reload do worker (não estritamente necessário — ele lê do DB).

### `OPENAI_API_KEY`

```bash
# 1. Criar nova key em https://platform.openai.com/api-keys (chamar "atlas-seller-2026-q3" ou similar)
# 2. Adicionar no .env (manter a antiga temporariamente)
# 3. Reload erp-web
pm2 reload erp-web --update-env
# 4. Testar /api/contas/nf-extract com um PDF
# 5. Revogar a key antiga no dashboard OpenAI
```

### `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

Rotação trimestral conforme IAM best practice.

```bash
# 1. No console AWS IAM → user → "Security credentials" → criar segunda access key
# 2. Adicionar no .env (substituir)
# 3. Reload sqs-consumer
pm2 reload erp-sqs-consumer --update-env
# 4. Tail dos logs por ~5min para confirmar consumo SQS
pm2 logs erp-sqs-consumer
# 5. Deletar access key antiga no IAM
```

### SMTP_USER / SMTP_PASS

```bash
# Se Gmail App Password:
# 1. https://myaccount.google.com/apppasswords → revogar antiga → gerar nova
# 2. Editar .env
# 3. Reload erp-web
pm2 reload erp-web --update-env
# 4. Testar fluxo "Esqueci minha senha" (recebe email?)
```

### Gmail OAuth (cliente + refresh token)

Procedimento similar ao LWA Amazon:
1. Revogar acesso em https://myaccount.google.com/permissions
2. Re-autorizar via `/configuracoes` (botão "Conectar Gmail").
3. `state` agora é validado (CSRF mitigado — ver [src/lib/gmail.ts](../src/lib/gmail.ts)).

### Postgres `erp_amazon` password

```bash
# 1. Gerar nova senha
NEW_PG_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')

# 2. Trocar no Postgres
sudo -u postgres psql -d erp_amazon -c "ALTER ROLE erp_amazon WITH PASSWORD '${NEW_PG_PASSWORD}';"

# 3. Editar .env (DATABASE_URL)
# 4. Reload todos
pm2 reload erp-web erp-worker erp-sqs-consumer --update-env

# 5. Verificar /api/health
curl -s http://127.0.0.1:3000/api/health | jq .ok
```

Após split de roles (ver [postgres-roles.md](postgres-roles.md)), rotacionar `erp_amazon_app` segue o mesmo padrão.

---

## Em caso de incidente (vazamento confirmado)

Ordem de execução em emergência:

1. **`SESSION_SECRET`** primeiro — invalida todas as sessões e desloga atacantes ativos.
2. **Postgres password** — bloqueia acesso ao DB se a `.env` vazou.
3. **`CRON_SECRET` + `INTERNAL_HEALTH_TOKEN`** — bloqueia cron forjado.
4. **AWS keys** — desabilita no IAM imediatamente (não esperar rotação).
5. **OPENAI / SMTP** — revogar nos provedores externos.
6. **Amazon LWA + Gmail OAuth** — revogar nos respectivos consoles + reconfigurar.
7. **`CONFIG_ENCRYPTION_KEY`** — só se houver evidência de leitura do `.env`. Trocar implica reconfigurar Amazon/Gmail.

Documentar timeline do incidente em `docs/incidents/YYYY-MM-DD-<slug>.md` (criar pasta na primeira ocorrência).

---

## Lembretes

- **NUNCA** commitar `.env` no git (já está em `.gitignore`).
- **NUNCA** logar valores de secret (logger redige `*.password`, `*.token`, `*.secret`, `*.key`).
- **NUNCA** copiar/colar segredo em chat, ticket ou PR description.
- **SEMPRE** revogar valor antigo após confirmar que o novo funciona — não deixar dois ativos por mais de 24h.
