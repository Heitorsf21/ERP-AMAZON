# Contexto — ERP Amazon

## Stack
- Next.js App Router + TypeScript + Prisma
- **Banco**: SQLite em dev local; **PostgreSQL alvo de produção** (schema preservado em `prisma/schema.postgresql.prisma`, migration inicial em `prisma/migrations/20260425000000_init_postgres/migration.sql`).
- Dev: `http://localhost:3000` | PID salvo em `.dev-server.pid`
- Dinheiro sempre em centavos (`Int`). Fuso: `America/Sao_Paulo`.
- Nunca expor `.env` ou `OPENAI_API_KEY`. Backup `.env.backup` é descartável.
- ESLint flat config em `eslint.config.mjs`. `next.config.mjs` usa `typedRoutes: true`.
- Logger `pino` (em `src/lib/logger.ts`). Nada de `console.log` espalhado.

## Versões-chave
next 16.2.4 · vitest 4.1.4 · eslint 9.39.4 · prisma 5.22.0 · @libpdf/core (PDF protegido por senha)

## Schema Prisma — modelos ativos
DossieFinanceiro · DocumentoFinanceiro · ContaPagar · ContaReceber · Movimentacao · Fornecedor · Categoria
Produto · MovimentacaoEstoque · PedidoCompra · ItemPedidoCompra · Usuario
AmazonSyncLog · AmazonSyncJob · AmazonApiQuota · AmazonReviewSolicitation · AmazonSettlementReport · BuyBoxSnapshot
ConfiguracaoSistema · ImportacaoLote · LoteImportacaoFBA · VendaFBA · LoteMetricaGS · ProdutoMetricaGestorSeller
VendaAmazon · AmazonReembolso · AdsGastoManual · AdsCampanha · Notificacao

## Regras de negócio críticas

### Documentos financeiros
- SHA256 único por documento. Reenvio → retorna DUPLICADO.
- PDF protegido: @libpdf/core → texto → IA. PDF sem senha: enviado à OpenAI como input_file. Imagem: input_image.
- Matching boleto/NF: CNPJ, valor, vencimento, nº documento, linha digitável, chave de acesso.
- Tolerância de valor: R$ 5,00 ou 0,2% (o maior), somente com data próxima e fornecedor compatível.
- Boleto chega depois de NF → valor/vencimento do dossiê priorizam o boleto.
- Conta criada com dossieId → vincula dossiê. Sem dossieId → tenta vincular automaticamente.
- Documento já pago por movimentação bancária → cria conta como PAGA; vencimento = data real do pagamento (Movimentacao.dataCaixa).

### Contas a pagar
- Abas: Abertas · Vencidas · Pagas · Todas.
- Filtros rápidos: Hoje · Ontem · 7 dias · 30 dias · Vitalício.
- Em Abertas/Todas: "7 dias" e "30 dias" olham próximos vencimentos.
- Em Vencidas/Pagas: olham vencimentos passados.

### Contas a receber (Amazon)
- CSV Unified Transaction: 9 linhas de cabeçalho + 1 linha de nomes de colunas, 24 campos.
- `parseAmazonCSV` aceita string, Buffer ou Uint8Array (suporta upload manual e download via Reports API).
- Status da transação: Liberado (já transferido) | Diferido (a receber).
- Diferidos → ContaReceber PENDENTE por liquidação (liquidacaoId).
- Reimportação: atualiza existentes por liquidacaoId.
- Qualquer linha "Transferir" na liquidação = TRANSFERIDO (nunca usar threshold %).
- Liquidação marcada como TRANSFERIDO no CSV mais recente → ContaReceber = RECEBIDA.
- Reimportação de CSV parcial: usa Math.max(existente, novo) para valor e totalPedidos.
- Ciclo médio de liquidação: ~14 dias (dataPrevisao = data última transação + 14 dias).
- Marcar recebida manualmente: POST /api/contas-a-receber/[id]/marcar-recebida.
- totais() retorna: totalPendenteCentavos, quantidadePendente, totalRecebidaCentavos, quantidadeRecebida, totalCentavos.
- **Settlement automático**: job `SETTLEMENT_REPORT_SYNC` baixa o CSV via Reports API a cada 6h e chama `importarAmazonCSV`. Upload manual permanece como fallback.
- **Reconciliação Nubank**: `reconciliarRecebimentosAmazon()` em `jobs-handlers.ts` cruza `Movimentacao` ENTRADA + descrição "Amazon" ↔ `ContaReceber` PENDENTE (tolerância R$ 5 ou 0,5%, ±3 dias). Roda a cada loop do worker.

## Worker daemon (alimentação 24/7)
- `npm run amazon:worker` — daemon contínuo que processa `AmazonSyncJob`.
- `npm run amazon:worker:once` — uma rodada só.
- `npm run amazon:test` — bateria de smoke test em todas as APIs SP-API (LWA + 9 endpoints).
- Heartbeat gravado em `ConfiguracaoSistema.worker_heartbeat_at` a cada loop.
- Watchdog (`deploy/watchdog.sh`) reinicia o worker via PM2 se heartbeat > 5min.

### Schedules dos jobs (em `src/modules/amazon/jobs.ts`)
| Job | Intervalo | Notas |
|---|---|---|
| `ORDERS_SYNC` | 2min | últimos 3 dias, 1 página |
| `INVENTORY_SYNC` | 5min | snapshot FBA |
| `FINANCES_SYNC` | 30min | últimos 14 dias |
| `REFUNDS_SYNC` | 1h | últimos 90 dias |
| `BUYBOX_CHECK` | 15min | rotaciona SKUs ativos com ASIN |
| `CATALOG_REFRESH` | 24h | imagem, título, categoria |
| `SETTLEMENT_REPORT_SYNC` | 6h | baixa CSV via Reports API |
| `REVIEWS_DISCOVERY` | 6h | descobre pedidos elegíveis |
| `REVIEWS_SEND` | 1h | dispara solicitations |

### Rate limit adaptativo
- Limites default em `src/lib/amazon-rate-limit.ts` (oficiais SP-API).
- `adoptObservedRateLimit()` lê o header `x-amzn-RateLimit-Limit` em cada resposta e calibra `AmazonApiQuota.observedRps` se a Amazon liberar mais do que o default. Nunca extrapola.
- Cada operação tem cooldown próprio em `AmazonApiQuota.nextAllowedAt`.
- Erro 429 → `markAmazonOperationRateLimited()` (respeita `retry-after`); chamadas seguintes lançam `AmazonQuotaCooldownError` que vira retry no worker.

### Bugs conhecidos / corrigidos
- **`getInventorySummaries` paginação** (corrigido em 2026-04-25): a Amazon exige `marketplaceIds` em TODA página, não só na primeira. O fix passa `baseParams` junto com `nextToken`.

### Buybox — comparação por sellerId
- `runBuyboxCheck` em `src/modules/amazon/jobs-handlers.ts` lê `amazon_seller_id` de `ConfiguracaoSistema` e seta `BuyBoxSnapshot.somosBuybox = sellerBuybox === amazon_seller_id`. Se o `amazon_seller_id` não estiver definido, faz fallback para heurística de preço (tolerância 50 centavos). `BuyBoxSnapshot.sellerBuybox` é sempre persistido.
- Para popular: rodar `npx tsx scripts/sync-seller-id.ts --set <SELLER_ID>` (o ID está em Seller Central → Settings → Account Info → Your Merchant Token). A rota automática via `/sellers/v1/account` não retorna `sellerId` para essa conta — daí o setup manual.
- `SELLERS_GET` adicionada em `src/lib/amazon-rate-limit.ts` (0.016 rps, burst 15).

### SP-API — roles necessárias
- Roles ativas (OK): `Inventory and Order Tracking`, `Finance and Accounting`.
- **Falta habilitar (causa 403)**: `Product Listing` (Catalog Items API). `Pricing` recomendada para `getProductOffers` retornar dados reais.
- Habilitar em https://sellercentral.amazon.com/developer/applications. Após salvar, "Authorize again" em Manage Your Apps gera novo `refresh_token` que precisa ser atualizado em `/amazon`.

## Notificações operacionais (sino do ERP)
- Modelo `Notificacao` com dedupeKey @unique. Helpers em `src/lib/notificacoes.ts`.
- Tipos: `ESTOQUE_CRITICO` · `BUYBOX_PERDIDO` · `BUYBOX_RECUPERADO` · `REEMBOLSO_ALTO` · `ACOS_ALTO` · `LIQUIDACAO_ATRASADA` · `CUSTO_AUSENTE` · `JOB_FALHANDO` · `QUOTA_BLOQUEADA` · `SETTLEMENT_NOVO` · `RECEBIMENTO_RECONCILIADO` · `WORKER_REINICIADO`.
- `JOB_FALHANDO` é emitida pelo worker quando um job esgota `maxAttempts`.

## Criptografia de credenciais
- `src/lib/crypto.ts` — AES-256-GCM. Chave master em `CONFIG_ENCRYPTION_KEY` (32 bytes hex).
- `saveAmazonConfig()` criptografa automaticamente chaves cujo nome contenha `secret`, `token`, `password`, `senha`, `_key`, `_apikey` (heurística `isSecretConfigKey`).
- `getAmazonConfig()` descriptografa transparentemente. Valores legados em texto puro continuam funcionando (compatibilidade).
- Sem `CONFIG_ENCRYPTION_KEY` setado, salva em texto puro (modo dev permissivo). Em produção, exigir.

## Arquivos de referência (não apagar)
- MARTINS_9349830.pdf (senha: 10338212) — boleto protegido
- 8f0c1001-...pdf — NF da mesma compra
- NU_4699049964_01AGO2025_15ABR2026.csv/.ofx — extrato Nubank (ago/2025–abr/2026)
- NU_4699049964_01ABR2026_16ABR2026.csv — extrato Nubank abr/2026 (último lançamento Amazon: 13/04)
- 2026MarMonthlyUnifiedTransaction.csv — Amazon março/2026 (329 txns)
- 2026Apr1-2026Apr15CustomUnifiedTransaction.csv — Amazon abr 1-15/2026 (123 txns, original)
- 2026Apr1-2026Apr15CustomUnifiedTransaction (1).csv — Amazon abr 1-15/2026 (reimportação com Transferir de 06/04, 08/04, 13/04)
- prisma/schema.postgresql.prisma — schema Postgres alvo de produção (não apagar)
- prisma/migrations/20260425000000_init_postgres/migration.sql — DDL pronto para `prisma migrate deploy`

## Rotas principais
- /api/health — **público** (sem sessão, usado pelo watchdog/Nginx). Retorna db.ok, worker.lastHeartbeatAt, queue, quota.cooldowns, lastSync por tipo.
- /api/contas — GET (filtros: status, de, ate) · POST (criar)
- /api/contas/[id] — PATCH · DELETE
- /api/contas/[id]/pagar — POST { pagoEm: "YYYY-MM-DD" } → cria Movimentacao SAIDA + marca PAGA + gera próxima se MENSAL
- /api/contas/[id]/reverter — POST → desfaz pagamento (deleta Movimentacao, volta ABERTA/VENCIDA)
- /api/contas-a-receber — GET (?status=PENDENTE|RECEBIDA)
- /api/contas-a-receber/importar-amazon — POST multipart (arquivo CSV) — fallback manual
- /api/contas-a-receber/totais — GET
- /api/contas-a-receber/[id]/marcar-recebida — POST
- /api/documentos-financeiros · /api/fornecedores (force-dynamic)

### Estoque
- /api/estoque/produtos — GET (?ativo, ?busca) · POST
- /api/estoque/produtos/[id] — GET · PATCH · DELETE
- /api/estoque/produtos/[id]/movimentacoes — GET · POST
- /api/estoque/totais — GET (CardResumoEstoque, dashboard)
- /api/estoque/importar — POST (bulk upsert planilha)

### Caixa / Documentos (totais para stat strips do Financeiro)
- /api/caixa/totais — GET → { entradasCentavos, saidasCentavos, variacaoCentavos } do mês corrente em America/Sao_Paulo (consumido pela aba Caixa)
- /api/contas/totais — GET → { emAbertoCentavos, vencidasCentavos, pagasMesCentavos, totalMesCentavos, qtd... } do mês corrente (consumido por Contas a Pagar)
- /api/documentos-financeiros/totais — GET → { total, boletos, notasFiscais, semConta } (consumido por Notas Fiscais; "semConta" conta DocumentoFinanceiro cujo dossie.contaPagarId é null)

### Compras (F5)
- /api/compras — GET (?status) · POST (criar rascunho)
- /api/compras/[id] — GET · PATCH · DELETE (cancelar)
- /api/compras/[id]/confirmar — POST → status CONFIRMADO + cria ContaPagar
- /api/compras/[id]/receber — POST → status RECEBIDO + MovimentacaoEstoque ENTRADA por item
- /api/compras/sugestoes — GET (produtos com statusReposicao REPOR/ATENCAO)
- /api/compras/totais — GET (CardResumoCompras, dashboard)

### Destinação de Caixa (F6)
- /api/destinacao/resumo — GET → { saldoAtual, comprometidoContas, comprometidoCompras, totalComprometido, aReceber, saldoLivre, saldoProjetado }

### DRE
- /api/dre/resumo — GET (?de, ?ate, ?modo=mensal&ano=YYYY). Resposta inclui blocos extras `amazon` (vendasBrutas, vendasLiquidas, taxas, fretes, reembolsos), `cpv` (calculado real via MovimentacaoEstoque vs contasPagas) e `ads` (campanhas + manual).

### Conector Amazon / SP-API (F7)
- /api/amazon/config — GET (credenciais mascaradas, decriptadas no servidor) · POST (criptografa secrets antes de salvar)
- /api/amazon/sync — POST { tipo: ORDERS|INVENTORY|FINANCES|REFUNDS|TEST, diasAtras? }
- /api/amazon/status — GET (histórico AmazonSyncLog)
- /api/amazon/jobs — GET (resumo da fila + últimos 20 jobs)
- /api/amazon/quota — GET (snapshot AmazonApiQuota)
- /api/amazon/worker — POST (processa N jobs, usado por crons externos se quiser)
- /api/amazon/sync-buybox · /api/amazon/sync-catalog · /api/amazon/sync-settlement — disparos manuais
- /api/amazon/reviews/* — automação de solicitações (cron-daily, config, produtos, send, metricas)
- Credenciais salvas em `ConfiguracaoSistema` (criptografadas) com chaves: `amazon_client_id`, `amazon_client_secret`, `amazon_refresh_token`, `amazon_marketplace_id`, `amazon_endpoint`.
- Autenticação: LWA OAuth2 (refresh_token → access_token, header `x-amz-access-token`). Sem AWS SigV4 — apps privados não precisam.

### Sistema (saúde)
- /sistema — página com worker, fila, quotas, top tabelas do banco, contadores.
- /api/sistema/db-stats — GET (Postgres-only para tabela sizes; gracefully fallback em SQLite).

## Next.js 16 — params assíncrono (CRÍTICO)
Todos os handlers de rotas dinâmicas usam `params: Promise<{ id: string }>`:
```ts
type Params = { params: Promise<{ id: string }> };
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params; // NUNCA params.id diretamente
  ...
}
```

## Categorias disponíveis (contas a pagar)
Compra de mercadorias/produtos · Fretes e entregas · Contabilidade · Impostos · Marketing · Despesas operacionais · Serviços terceirizados · Tecnologia e sistemas · Taxas de plataformas/pagamentos

## Componentes UI compartilhados
- `src/components/ui/kpi-card.tsx` — `<KpiCard label value sub? icon? color highlight? valueClassName? className? />`. Cores: `blue | green | red | orange | violet | slate`. Padrão usado em todas as 7 abas Financeiro (Dashboard, Caixa, Contas a Pagar, Contas a Receber, Notas Fiscais, Destinação, DRE) e em Avaliações. Sempre preferir o `KpiCard` compartilhado em vez de criar variantes locais.

## Avaliações (solicitações Amazon)
- Aba `/avaliacoes` tem 5 KPIs no topo: Pedidos 30d · Sucesso (30 dias, verde) · Enviadas hoje · Adiados · Erros.
- Bloco "Envio manual" foi removido (não usado). Restam abas `Geral & Histórico` e `Por Produto`.
- Métrica `enviadas30d` em `getReviewMetrics()` filtra `AmazonReviewSolicitation` com `status = ENVIADO` e `sentAt >= hoje-30d`.

## Destinação de Caixa — UX de percentuais
- Cada input clampa em `100 − soma_das_outras_bolsas` no onChange (bloqueio na entrada, não só no save).
- Badge "X% / 100%" no header (verde quando =100, âmbar quando <100, vermelho quando >100).
- Painel `aria-live` abaixo dos inputs com mensagem contextual ("Faltam X%" / "Excede 100%").
- Botão Salvar disabled com tooltip explicativo. Backend valida em `setPercentuais()` (defesa em profundidade).

## Preferências do usuário
- Sem redesign radical. Melhorias visuais incrementais.
- Preferir botões/modais a blocos fixos.
- Propor protótipo antes de mudanças visuais grandes.
- Fluxo de documentos deve evitar duplicidade.
- Alertas SOMENTE no painel (sino), sem email/Slack/Telegram.

## Deploy — VPS Hostinger (`deploy/`)
Sem custos extras: PostgreSQL 16 auto-hospedado + Nginx + Let's Encrypt + PM2 + cron Linux.
- **Domínio**: `mundofs.cloud` é o site institucional da empresa; o ERP rodará em **subdomínio dela** (sugerir `erp.mundofs.cloud` — confirmar com usuário antes de configurar nginx/Let's Encrypt).
- `deploy/install-server.sh` — provisão Ubuntu (Node 20, Postgres 16, Nginx, Certbot, PM2).
- `deploy/postgres-setup.sql` — cria role/db `erp_amazon`.
- `deploy/nginx-erp.conf` — reverse proxy 443→3000 (substituir SEU_DOMINIO pelo subdomínio escolhido).
- `deploy/ecosystem.config.js` — PM2: `erp-web` (Next.js) + `erp-worker` (tsx scripts/amazon-worker.ts).
- `deploy/systemd/pm2-erp.service` — sobe PM2 no boot.
- `deploy/backup-postgres.sh` — pg_dump diário (14 daily + 8 weekly + tar uploads).
- `deploy/watchdog.sh` — verifica heartbeat e reinicia worker (cron */5min).
- `deploy/crontab.example` — agenda backup (03h) + watchdog (5min).
- Sequência completa em `deploy/README.md`.
- `vercel.json` foi removido (não usa Vercel).

## SQS (Notifications API — opcional, push real-time)
- Esqueleto em `src/lib/amazon-sqs.ts`.
- Ativa só se `AMAZON_SQS_QUEUE_URL` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` setados.
- Mapeia eventos Amazon → enfileira jobs:
  - `ORDER_CHANGE` → ORDERS_SYNC (priority 50)
  - `ANY_OFFER_CHANGED` → BUYBOX_CHECK (priority 40)
  - `FBA_INVENTORY_AVAILABILITY_CHANGES` → INVENTORY_SYNC (priority 35)
  - `REPORT_PROCESSING_FINISHED` → SETTLEMENT_REPORT_SYNC (priority 45)

## Scripts npm relevantes
| Script | O que faz |
|---|---|
| `npm run dev` | Next.js em watch |
| `npm run build` / `npm start` | produção |
| `npm run amazon:worker` | worker daemon contínuo |
| `npm run amazon:worker:once` | uma rodada só |
| `npm run amazon:test` | smoke test de todas as APIs SP-API |
| `npm run prisma:generate` | gera Prisma Client |
| `npm run prisma:push` | sincroniza schema (dev local SQLite) |
| `npm run prisma:migrate` | gera nova migration (dev com Postgres) |
| `npm run prisma:migrate:deploy` | aplica migrations em produção |
| `npm run migrate:sqlite-to-postgres` | one-shot SQLite→Postgres (instala `better-sqlite3` antes) |
| `npm run db:seed` | seed |

## Processo ao alterar Prisma
1. Encerrar servidor Next se rodando (verifica PID antes).
2. `npm.cmd run prisma:generate && npm.cmd run prisma:push` (dev SQLite) **OU** `npm run prisma:migrate -- --name <nome>` (dev Postgres).
3. Reiniciar servidor.
4. Em produção: `npm run prisma:migrate:deploy`.

## Validação — rodar SOMENTE no que foi alterado
Após cada alteração, testar apenas os arquivos/módulos modificados:
- Lint: `npx eslint <arquivo>`
- Typecheck: `npx tsc --noEmit` (se tocou tipos)
- Testes: `npx vitest run <arquivo>` (somente o arquivo de teste relacionado)
- Build completo somente quando explicitamente solicitado ou antes de deploy.
Não rodar `npm run test` completo após cada comando — desnecessário e caro.
