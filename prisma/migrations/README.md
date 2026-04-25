# Prisma Migrations

A migration inicial (`20260425000000_init_postgres/migration.sql`) já foi gerada
com o schema completo (28 modelos + BuyBoxSnapshot, índices, FKs com onDelete,
campos Json e tudo mais).

## Aplicar em produção (VPS)

Tendo `DATABASE_URL` apontando para o Postgres da VPS:

```bash
npm run prisma:migrate:deploy
```

Esse comando aplica todas as migrations do diretório que ainda não foram
executadas. É idempotente.

## Gerar novas migrations (em dev local com Postgres rodando)

```bash
npm run prisma:migrate -- --name <nome_descritivo>
```

Exemplo: `npm run prisma:migrate -- --name add_relatorio_x`.

## Nunca usar `prisma db push` em produção

`db push` aplica o schema diretamente sem criar histórico — só serve em dev local.
Em produção, sempre use `migrate deploy`.

## Migrar dados de SQLite (se vier de uma instalação anterior)

```bash
# Instale temporariamente o driver SQLite:
npm i -D better-sqlite3

# Aponte SQLITE_URL para o arquivo antigo (default: file:./prisma/dev.db) e DATABASE_URL para o Postgres alvo:
SQLITE_URL="file:./prisma/dev.db" npm run migrate:sqlite-to-postgres
```
