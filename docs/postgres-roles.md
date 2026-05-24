# Postgres least-privilege — Runbook

## Por que

Hoje a aplicação (`erp-web` + `erp-worker` + `erp-sqs-consumer`) conecta no Postgres com o role `erp_amazon`, que tem `ALL PRIVILEGES` na database (criado por `deploy/postgres-setup.sql`). Se um SQL injection escapar das defesas (Prisma + Zod), ou uma chave do `.env` vazar, o blast radius inclui `DROP TABLE`, criar usuário Postgres, ler `pg_authid`, etc.

Este runbook separa o role em dois:

| Role | Quem usa | Privilégios |
|---|---|---|
| `erp_amazon_owner` | só `prisma migrate deploy` em janelas controladas | Owner do schema, todos DDL |
| `erp_amazon_app` | runtime (app + worker + consumer) | `SELECT, INSERT, UPDATE, DELETE` apenas |

## Estado atual (não-feito)

Este runbook **não foi executado ainda**. `deploy/postgres-setup.sql` continua intacto. Execute manualmente na próxima janela de manutenção.

## Pré-requisitos

- Acesso SSH a `erp-vps` como usuário com sudo (`mundofs`).
- Backup recente (verificar `ls -lh /backups/daily/`).
- App rodando normalmente (`pm2 status`).

## Passo 1 — Criar o role app + grants (sem mudar o app ainda)

Conecte como superuser e crie o role com privilégios mínimos. Geramos uma senha forte e armazenamos em `.env` na próxima etapa.

```bash
# Conecte no VPS como root ou usuário com sudo
ssh erp-vps

# Gerar senha
APP_PG_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')
echo "APP_PG_PASSWORD=${APP_PG_PASSWORD}"  # anote — vai pro .env depois

# Conectar como postgres super
sudo -u postgres psql -d erp_amazon <<SQL
-- 1. cria role app (sem CREATEDB, sem SUPERUSER, sem replication)
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_amazon_app') THEN
    EXECUTE format('CREATE ROLE erp_amazon_app WITH LOGIN PASSWORD %L', '${APP_PG_PASSWORD}');
  END IF;
END\$\$;

-- 2. permissoes minimas no banco
GRANT CONNECT ON DATABASE erp_amazon TO erp_amazon_app;
GRANT USAGE ON SCHEMA public TO erp_amazon_app;

-- 3. CRUD em todas as tabelas existentes
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_amazon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_amazon_app;

-- 4. default privileges para tabelas futuras criadas pelo owner
ALTER DEFAULT PRIVILEGES FOR ROLE erp_amazon IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_amazon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE erp_amazon IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_amazon_app;

-- 5. confere
\\du erp_amazon_app
SELECT * FROM information_schema.role_table_grants
  WHERE grantee = 'erp_amazon_app' LIMIT 5;
SQL
```

## Passo 2 — Configurar `.env` com duas URLs

No VPS:

```bash
sudo -u erp -i
cd /opt/erp-amazon

# Backup do .env atual
cp .env .env.bak.$(date +%Y%m%d-%H%M)

# Editar .env:
#   - DATABASE_URL → trocar para erp_amazon_app + nova senha (uso runtime)
#   - MIGRATION_DATABASE_URL → manter erp_amazon antigo (uso migration)
```

Exemplo do `.env` final:

```
# Runtime (app, worker, sqs-consumer) — sem DDL
DATABASE_URL="postgresql://erp_amazon_app:SENHA_NOVA@127.0.0.1:5432/erp_amazon?schema=public&connection_limit=10&pool_timeout=20"

# Migration (rodar manualmente em janela de deploy)
MIGRATION_DATABASE_URL="postgresql://erp_amazon:SENHA_ANTIGA@127.0.0.1:5432/erp_amazon?schema=public"
```

## Passo 3 — Reload do app

```bash
pm2 reload erp-web erp-worker erp-sqs-consumer --update-env

# Verificar que tudo voltou ok (~5s)
pm2 logs --lines 50

# Health check
curl -s http://127.0.0.1:3000/api/health | jq .ok
# esperado: true
```

## Passo 4 — Atualizar comando de migration

Migrations agora rodam com `MIGRATION_DATABASE_URL`. Editar o playbook em `CLAUDE.md` ou criar wrapper:

```bash
# Em deploy script ou comando manual:
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:migrate:deploy:pg
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:generate:pg
```

Importante: NÃO usar o role `erp_amazon_app` para migrations — ele não tem `CREATE TABLE`/`ALTER TABLE` e vai falhar.

## Passo 5 — Verificar que o app não consegue mais DDL

Conferir que o role app é realmente restrito:

```bash
sudo -u postgres psql -d erp_amazon <<SQL
SET ROLE erp_amazon_app;

-- Deve funcionar (SELECT)
SELECT count(*) FROM "Usuario";

-- Deve falhar com "permission denied"
DROP TABLE IF EXISTS "Usuario";
SQL
```

## Rollback (se algo der errado em prod)

```bash
sudo -u erp -i
cd /opt/erp-amazon
cp .env.bak.YYYYMMDD-HHMM .env
pm2 reload erp-web erp-worker erp-sqs-consumer --update-env
```

Após rollback, app volta a usar `erp_amazon` (owner) tanto para runtime quanto migration. Role `erp_amazon_app` segue criado mas sem uso — pode dropar ou deixar.

## Cuidados especiais

1. **Backup user**: scripts em `deploy/backup-postgres.sh` rodam com `pg_dump`. Já passam `-U "$DB_USER"` com env var. Atualizar `DB_USER=erp_amazon` continua funcionando (owner pode ler tudo). NÃO trocar pra `erp_amazon_app` (não tem todos os privilégios de dump em algumas tabelas internas).

2. **Watchdog / health**: NÃO afeta — usa `INTERNAL_HEALTH_TOKEN`.

3. **Auditoria**: o app continua escrevendo em `AuditLog` (INSERT está permitido).

4. **Default privileges**: importante a cláusula `ALTER DEFAULT PRIVILEGES FOR ROLE erp_amazon`. Sem ela, a próxima `prisma migrate deploy` cria tabelas que o `erp_amazon_app` NÃO consegue ler/escrever. Cada migration tem que rodar com `MIGRATION_DATABASE_URL` (owner) — daí pra frente o default privilege libera para o app.

## Verificação periódica

Rodar trimestralmente:

```bash
sudo -u postgres psql -d erp_amazon -c "
SELECT grantee, privilege_type, table_name
FROM information_schema.role_table_grants
WHERE grantee IN ('erp_amazon', 'erp_amazon_app')
ORDER BY grantee, table_name, privilege_type;
"
```

Deve mostrar:
- `erp_amazon`: todos os privilégios em todas as tabelas (owner)
- `erp_amazon_app`: APENAS `SELECT, INSERT, UPDATE, DELETE` em tabelas de app
