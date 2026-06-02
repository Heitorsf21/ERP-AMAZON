# Staging → Prod: Multitenant Fase 0 + 6 frentes de UX

Runbook para validar em **staging** antes de tocar a produção. Cobre o deploy de
`feat/multitenant-fase0-seguranca` (multitenant + as 6 frentes: sino, remoção de
Genius/Expedição, otimizador de Ads, agenda+recorrência, compras).

> **Regra do gate:** nunca migrar prod sem (1) backup verificado e (2) validação
> em staging contra cópia dos dados reais. Migrations de multitenant são difíceis
> de reverter.

## 0. Pré-flight — backup de produção (obrigatório)

```bash
ssh erp-vps
cd /opt/erp-amazon
TS=$(date +%Y%m%d_%H%M%S)
DBURL=$(sudo -u erp grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
mkdir -p backups
pg_dump "$DBURL" -Fc -f "backups/pre-multitenant_$TS.dump"
ls -lh "backups/pre-multitenant_$TS.dump"   # confirme tamanho > 0
```

Baixe o dump para fora do servidor (no seu PC): `scp erp-vps:/opt/erp-amazon/backups/pre-multitenant_$TS.dump .`

## 1. Subir o banco de staging a partir do dump

Use um Postgres **separado** do de produção. Mais simples: container local/efêmero.

```bash
# no host de staging (ou seu PC) — Docker:
docker run -d --name pg-staging -e POSTGRES_PASSWORD=staging -p 5544:5432 postgres:16
# cria o banco e restaura o dump de prod
docker exec -it pg-staging psql -U postgres -c "CREATE DATABASE erp_amazon;"
pg_restore --clean --if-exists --no-owner -d "postgresql://postgres:staging@localhost:5544/erp_amazon" pre-multitenant_$TS.dump
```

`STAGING_DB="postgresql://postgres:staging@localhost:5544/erp_amazon"`

## 2. Aplicar as migrations no staging (NÃO em prod)

```bash
# na raiz do repo, com a branch feat/multitenant-fase0-seguranca:
DATABASE_URL="$STAGING_DB" npm run prisma:migrate:deploy:pg
DATABASE_URL="$STAGING_DB" npm run prisma:generate:pg
```

Confirme que aplicou **todas** as migrations pendentes, incluindo
`20260601130000_tarefas_recorrentes` e as do multitenant. Sem erros = migration
limpa contra dados reais.

## 3. Subir o app apontando para o staging

```bash
DATABASE_URL="$STAGING_DB" TENANT_ISOLATION=enforce npm run build
DATABASE_URL="$STAGING_DB" TENANT_ISOLATION=enforce npm run start   # ou dev
```

`TENANT_ISOLATION=enforce` é o que ativa o isolamento por empresa (inclui o sino).

## 4. Checklist de validação (as 6 frentes + multitenant)

- [ ] **Multitenant**: login em 2 empresas distintas; dados de uma NÃO aparecem na outra (vendas, contas, notificações, tarefas). Onboarding/login por slug OK.
- [ ] **Sino**: abrir o popover → lista as últimas não-lidas (não fica vazio); número bate; `/notificacoes` continua listando; notificações de outra empresa não vazam.
- [ ] **Genius Pro / Expedição**: itens sumiram da sidebar e do Ctrl+K; `/genius` e `/expedicao` retornam 404. Nenhuma outra tela quebrou.
- [ ] **Otimizador de Ads**: card do SKU mostra imagem + faixa "última ação"; aba **Histórico** carrega e expande (proposta/motivo/risco/métricas/decisão/resultado).
- [ ] **Agenda**: abre em **Semana**; toggle Dia/Mês funciona; painel **"A concluir"** agrupa (atrasadas/hoje/semana/sem prazo); criar **tarefa recorrente** gera as ocorrências; concluir 1 não conclui as outras; editar molde com "aplicar às futuras" propaga só às abertas; tarefa PESSOAL só visível ao dono.
- [ ] **Compras**: sem mural de sugestões; KPIs por período corretos; filtros (período/fornecedor) e busca; miniaturas e previsão na lista; timeline no detalhe; "Novo pedido" sugere reposição e preenche itens.
- [ ] **Build/health**: `npm run build` verde; `/api/health` responde; `pm2 status` (se aplicável) sem restart-loop.

## 5. Promover para produção (só após o checklist passar)

```bash
# publicar na main (no seu PC):
git checkout main && git pull --ff-only
git merge feat/multitenant-fase0-seguranca
git push origin main
```

```bash
# deploy no VPS (sequência do CLAUDE.md):
cd /opt/erp-amazon && \
git stash push -m "pre-deploy-$(date +%s)" -- src/lib/amazon-sp-api.ts src/lib/amazon-ads-api.ts src/lib/amazon-sqs.ts package-lock.json && \
git pull --ff-only origin main && \
npm install --no-audit --no-fund && \
npm run prisma:migrate:deploy:pg && \
npm run prisma:generate:pg && \
rm -rf .next && npm run build && \
pm2 reload erp-web --update-env && pm2 reload erp-worker --update-env && pm2 reload erp-sqs-consumer --update-env
```

Pós-deploy: `GIT_SHA=$(git rev-parse --short HEAD)` no `.env` + `pm2 reload erp-web --update-env`; conferir `/api/health`. Garantir `TENANT_ISOLATION=enforce` no `.env` de prod.

## 6. Rollback (se algo der errado em prod)

```bash
# código:
git reset --hard <sha-anterior> && npm run prisma:generate:pg && rm -rf .next && npm run build && \
pm2 reload erp-web erp-worker erp-sqs-consumer
# dados (se a migration já rodou e corrompeu algo):
pg_restore --clean --if-exists --no-owner -d "$DBURL" backups/pre-multitenant_<TS>.dump
```

## Limpeza do staging
`docker rm -f pg-staging` (descarta o banco efêmero de staging).
