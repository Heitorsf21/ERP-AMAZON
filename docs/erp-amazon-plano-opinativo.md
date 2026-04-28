 q# ERP-AMAZON - leitura opinativa e alteracoes possiveis

Gerado em: 2026-04-27

## Objetivo

Este documento traduz o plano de VPS 24/7, backfill historico e evolucao para ERP em uma leitura pratica do projeto atual. A ideia aqui nao e repetir o roadmap original, e sim dizer o que eu manteria, o que eu mudaria antes de executar, quais riscos eu vejo e quais alteracoes fazem mais sentido para transformar esse plano em trabalho seguro.

## Minha leitura geral

O plano esta no caminho certo: subir a VPS antes do backfill e a decisao correta. O projeto ja tem uma base real para isso: Next.js, Prisma, worker Amazon, fila `AmazonSyncJob`, rate limit SP-API, criptografia de credenciais, deploy com PM2/Nginx/Postgres e jobs Amazon recorrentes.

Minha principal opiniao: antes de adicionar muitos endpoints novos, eu faria uma sprint curta de "confiabilidade de producao". Hoje existem pequenos desalinhamentos que podem quebrar o go-live mesmo com o codigo funcional localmente. Depois disso, eu atacaria primeiro os dados financeiros brutos e reimbursements, porque eles viram dinheiro e confianca na DRE.

## Estado atual observado no codigo

- O conector Amazon ja esta bem alem de um MVP: existem `ORDERS_SYNC`, `FINANCES_SYNC`, `REFUNDS_SYNC`, `INVENTORY_SYNC`, reviews, settlements, buybox, catalog refresh e `REPORTS_BACKFILL`.
- `src/modules/amazon/jobs.ts` centraliza schedules e dedupe de jobs.
- `src/modules/amazon/worker.ts` despacha os jobs e grava heartbeat em `ConfiguracaoSistema.worker_heartbeat_at`.
- `src/modules/amazon/jobs-handlers.ts` ja tem o template certo para backfill por report: cursor, pending report id, polling e idempotencia.
- `src/lib/amazon-sp-api.ts` ja tem wrappers importantes: `createReport`, `getReport`, `getReportDocument`, `listFinancialTransactions`, `getInventorySummaries`, Catalog e Pricing.
- `src/lib/amazon-sqs.ts` existe, mas ainda e stub: mapeia notificacoes para jobs, porem nao faz polling real no SQS.
- `deploy/` esta bem encaminhado: Postgres 16, PM2, Nginx, backup, watchdog e crontab.
- O projeto ainda usa `prisma/schema.prisma` como SQLite local e `prisma/schema.postgresql.prisma` para Postgres, o que exige cuidado extra no deploy.

## Correcoes importantes no plano original

1. Marketplace ID do Brasil

O plano colado cita um marketplace ID estranho (`A1VBAL9TL5Asort`). O codigo atual usa `A2Q3Y263D00KWC`, que confere com a documentacao oficial de Marketplace IDs da SP-API para Brasil. Eu manteria `A2Q3Y263D00KWC`.

2. Deploy Prisma pode falhar se nao usar o schema Postgres

`package.json` roda `prisma migrate deploy` sem `--schema`. Por padrao, o Prisma usa `prisma/schema.prisma`, que esta configurado como SQLite. A pasta `prisma/migrations` esta com `migration_lock.toml` de Postgres. Antes da VPS, eu ajustaria os scripts para Postgres usarem explicitamente:

```bash
prisma migrate deploy --schema prisma/schema.postgresql.prisma
prisma generate --schema prisma/schema.postgresql.prisma
```

Ou unificaria o schema para Postgres e deixaria SQLite apenas como legado. Esse e um bloqueador real de go-live.

3. Watchdog e healthcheck estao desalinhados

`deploy/watchdog.sh` chama `http://127.0.0.1:3000/api/health` e espera `worker.lastHeartbeatAt`. Mas `src/app/api/health/route.ts` so devolve detalhes para sessao `ADMIN`; sem sessao, retorna apenas status agregado. Resultado: o watchdog pode nao conseguir detectar worker travado pelo heartbeat.

Minha sugestao: criar um healthcheck interno protegido por token, por exemplo `/api/internal/health?token=...`, ou permitir detalhes quando `X-Internal-Health-Token` bater com uma env. Nao deixaria isso para depois.

4. Paths de producao precisam ser padronizados

O plano fala em `/var/www/erp-amazon`, enquanto `deploy/` usa `/opt/erp-amazon`. Eu padronizaria tudo em `/opt/erp-amazon`, porque ja esta consistente no `ecosystem.config.js`, scripts e README de deploy.

5. Settlement deve nascer em V2

O codigo aceita `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE` e `GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`. A Amazon marcou o flat file antigo e XML para remocao em 2026-11-11. Eu faria a implementacao nova priorizando V2 e manteria o formato antigo so como fallback temporario.

6. Returns tem duas leituras uteis

Para FBA, o plano esta certo ao priorizar `GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`, porque traz devolucoes recebidas no fulfillment center, motivo e disposicao. Mas existe tambem report geral de returns por data de retorno (`GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE`), que pode ser util quando o fluxo FBM crescer. Eu criaria o modelo pensando em suportar ambos.

7. Sales & Traffic deve ficar condicional, mas com plano B moderno

`GET_SALES_AND_TRAFFIC_REPORT` ainda aparece na documentacao de Analytics Reports e exige Brand Analytics/Brand Registry. Ao mesmo tempo, a Amazon esta empurrando Sales & Traffic para Data Kiosk GraphQL. Minha opiniao: manter o report como implementacao mais simples da primeira versao, mas desenhar o modelo `AmazonSkuTrafficDaily` sem acoplar demais ao shape do report, para migrar para Data Kiosk depois.

8. Rate limit interno ja existe parcialmente

O plano fala em adicionar rate limit interno. O projeto ja tem um rate limit em memoria no `src/proxy.ts`: 300 req/15min por rota/IP e 10 req/15min para rotas auth. Eu nao adicionaria Upstash agora. So revisaria limites e lembraria que memoria por processo nao serve para multiplas instancias.

9. CSP/HSTS ja esta meio caminho andado

`src/proxy.ts` ja adiciona HSTS em producao e headers basicos. O Nginx ainda nao replica CSP/HSTS. Eu adicionaria CSP com cuidado depois de listar dependencias externas reais, para nao quebrar upload, imagens Amazon, OpenAI/Google ou assets do Next.

## Minha sequencia recomendada

### Sprint 0.5 - antes da VPS

Faria antes de qualquer backfill:

- Corrigir scripts Prisma para usar `schema.postgresql.prisma` em producao.
- Corrigir `watchdog.sh` versus `/api/health`.
- Padronizar caminho de deploy em `/opt/erp-amazon`.
- Instalar/registrar `pm2-logrotate`.
- Validar restore de backup local em banco temporario.
- Confirmar que `.env` e arquivos de upload/dev nao estao em um estado perigoso antes de commitar/deployar.
- Confirmar roles SP-API e corrigir Marketplace ID para `A2Q3Y263D00KWC` em qualquer doc/UI.

### Sprint 1 - go-live minimo confiavel

Subir VPS com web + worker + Postgres, mas sem tentar ativar tudo de uma vez.

Aceite de sucesso:

- `pm2 status` com `erp-web` e `erp-worker` online.
- Healthcheck interno mostra banco ok e heartbeat recente.
- Worker cria jobs recorrentes e processa pelo menos `ORDERS_SYNC` e `INVENTORY_SYNC`.
- Backup diario gera dump e upload tar.

### Sprint 2 - backfill que sustenta a DRE

Ordem que eu implementaria:

1. `REPORTS_BACKFILL` de pedidos, ja existente.
2. `AmazonFinanceTransaction` como tabela bruta.
3. `FINANCES_BACKFILL` salvando transacao crua antes de derivar taxa/reembolso.
4. `InventorySnapshot`, porque historico de inventario nao volta pela API.
5. `SETTLEMENT_BACKFILL` V2, deixando claro na UI quando o dado foi reconstruido por Finances.

Eu nao criaria dezenas de modelos nessa sprint. Primeiro garantir pedidos + financeiro bruto + DRE.

### Sprint 3 - dinheiro direto e causa raiz

Prioridade alta:

- `FBA_REIMBURSEMENTS_SYNC` com `GET_FBA_REIMBURSEMENTS_DATA`.
- `RETURNS_SYNC` com `GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA`.
- Cards simples em `/financeiro`, `/dre` e produto. Sem dashboard gigante neste momento.

Minha opiniao: reimbursements vem antes de Notifications API. Push e bonito, mas dinheiro esquecido e melhor ROI.

### Sprint 4 - push e reducao de polling

Depois que polling/backfill estiverem estaveis:

- Finalizar SQS com `@aws-sdk/client-sqs`.
- Persistir `AmazonNotification`.
- Criar processo PM2 `erp-sqs-consumer`.
- Reduzir frequencia dos schedules antigos para fallback.

Eu nao faria SigV4 manual para SQS. O ganho de evitar uma dependencia nao paga o risco.

### Sprint 5 - ERP de verdade

Ordem que eu recomendo:

1. Auditoria e permissoes granulares.
2. Variacoes de produto.
3. Picking/packing FBM.
4. Emissao fiscal via Focus NFe ou PlugNotas.
5. Multi-marketplace, com Mercado Livre antes de Shopee.

Minha opiniao: multi-marketplace antes de auditoria/permissao cria um sistema poderoso demais para operar no escuro.

### Sprint 6 - Genius Pro

So entraria aqui depois de ter buybox, trafego, catalogo, pricing e financeiro confiaveis:

- Scout de oportunidades.
- Competitor tracking.
- Repricer.

O repricer nao deve escrever preco real na Amazon sem:

- preview/validacao via Listings Items quando possivel;
- regra de preco minimo/maximo;
- auditoria;
- log de decisao;
- botao de kill switch.

## Alteracoes possiveis no codigo atual

### Infra/deploy

- Ajustar scripts:
  - `prisma:generate:pg`
  - `prisma:migrate:deploy:pg`
  - `prisma:migrate:dev:pg`
- Atualizar `deploy/README.md` e `deploy/install-server.sh` para usar esses scripts.
- Criar health interno para watchdog.
- Adicionar `pm2-logrotate` no roteiro de provisionamento.
- Adicionar teste mensal de restore em `deploy/restore-check.sh`.

### Amazon jobs

- Adicionar novos tipos em `TipoAmazonSyncJob`, mas em blocos pequenos:
  - primeiro `FINANCES_BACKFILL`, `SETTLEMENT_BACKFILL`, `INVENTORY_SNAPSHOT`;
  - depois `FBA_REIMBURSEMENTS_SYNC`, `RETURNS_SYNC`;
  - depois `TRAFFIC_SYNC`, `FBA_STORAGE_SYNC`, `LISTING_UPDATE`.
- Extrair helper de report lifecycle para evitar copiar o padrao de cursor/pending em cada handler.
  - Sugestao: `src/modules/amazon/report-runner.ts`.
- Criar parsers por report:
  - `src/modules/amazon/parsers/fba-reimbursements-tsv.ts`
  - `src/modules/amazon/parsers/fba-returns-tsv.ts`
  - `src/modules/amazon/parsers/fba-storage-fees-tsv.ts`

### Dados

- Criar `AmazonFinanceTransaction` antes de melhorar a DRE. Sem dado bruto, reconciliacao vira tentativa.
- Manter `payloadJson` nas tabelas brutas por pelo menos 180 dias. Ele salva integracao quando a Amazon muda campos.
- Criar `InventorySnapshot` agora, mesmo sem UI. O historico comeca no dia do deploy.
- Para backfills de reports, usar chaves naturais e `upsert`, nunca insert cego.

### UI

- `/amazon` precisa mostrar progresso real de backfill:
  - cursor atual;
  - janela em processamento;
  - pending report id;
  - ultima execucao;
  - erro recente.
- `/financeiro` deve ganhar primeiro o card de reimbursements.
- `/dre` deve separar:
  - Receita Amazon;
  - Taxas Amazon;
  - Frete/FBA;
  - Reimbursements;
  - Storage fees.
- Evitaria telas novas grandes antes de o dado estar confiavel.

### Seguranca

- Auditoria e permissoes entram antes de multiusuario serio.
- Rate limit atual esta ok para uma instancia, mas deve ser revisado antes de API publica.
- CSP deve ser adicionada em Nginx ou middleware, mas testada em browser.
- Secrets SP-API devem continuar em `ConfiguracaoSistema` cifrado; `.env` deve guardar somente chaves de infraestrutura.

## O que eu nao faria agora

- Nao implementaria Notifications API antes de backfill financeiro e reimbursements.
- Nao criaria todos os 27 modelos Prisma de uma vez.
- Nao faria uma abstracao generica de marketplace antes de Mercado Livre funcionar de ponta a ponta.
- Nao ligaria repricer automatico antes de auditoria, regras de margem e kill switch.
- Nao gastaria energia em A+ Content antes de Sales & Traffic e Returns estarem gerando insights.

## Roadmap ajustado

### 30 dias

Meta realista:

- VPS online 24/7.
- Postgres funcionando com migracoes corretas.
- Worker monitorado.
- Backfill de pedidos e financeiro bruto.
- Reimbursements e returns basicos.
- DRE vitalicia com dados confiaveis o suficiente para decisao.

### 60 dias

Meta realista:

- Auditoria.
- Permissoes granulares.
- Variacoes de produto.
- Picking/packing FBM inicial.
- Storage fees se os reports estiverem liberados.
- Sales & Traffic se Brand Registry/Brand Analytics estiver liberado.

### 90 dias

Meta realista:

- NF-e com provider externo.
- Mercado Livre como segundo canal.
- API publica v1 minima.
- Notifications API/SQS se ainda fizer sentido pelo volume.

### 120 dias

Meta realista:

- Competitor tracking.
- Scout beta.
- Repricer em modo sugestao.
- Repricer automatico so depois de semanas de simulacao.

## Checklist de decisao antes de comecar

- Brand Registry aprovado?
- Role `Product Listing` liberada?
- Role `Brand Analytics` liberada, se Sales & Traffic entrar?
- Role `Pricing`/`Amazon Fulfillment` suficiente para FBA reports e future Listings?
- Caminho de deploy sera `/opt/erp-amazon`?
- Prisma Postgres sera script separado ou schema unico?
- Watchdog vai usar token interno?
- O primeiro deploy vai migrar dados SQLite ou comecar banco limpo?

## Fontes externas consultadas

- Marketplace IDs SP-API: https://developer-docs.amazon.com/sp-api/lang-pt_BR/docs/marketplace-ids
- Finances `listTransactions`: https://developer-docs.amazon.com/sp-api/lang-en_US/reference/listtransactions
- FBA Reports: https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba
- Returns Reports: https://developer-docs.amazon.com/sp-api/docs/report-type-values-returns
- Analytics Reports: https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics
- Data Kiosk API: https://developer-docs.amazon.com/sp-api/lang-US/docs/data-kiosk-api
- Settlement report deprecation: https://developer-docs.amazon.com/sp-api/changelog/update-removal-of-xml-settlement-report-and-flat-file-settlement-report-date-changed-to-november-11-2026
- Search Catalog Items: https://developer-docs.amazon.com/sp-api/docs/search-catalog-items
