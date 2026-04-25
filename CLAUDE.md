# Contexto — ERP Amazon

## Stack
- Next.js 16.2.4 App Router · TypeScript · Prisma 5.22 · React 18
- **Banco**: SQLite em dev (`prisma/dev.db`); Postgres alvo de produção (`prisma/schema.postgresql.prisma` + `prisma/migrations/20260425000000_init_postgres/`)
- Dev: `http://localhost:3000` · PIDs em `.dev-server.pid` e `.dev-worker.pid`
- Dinheiro em centavos (`Int`) · Fuso `America/Sao_Paulo`
- Logger `pino` em `src/lib/logger.ts` — sem `console.log` espalhado
- ESLint flat (`eslint.config.mjs`) · `next.config.mjs` com `typedRoutes: true`
- Nunca expor `.env` · `.env.backup` é descartável

## Schema Prisma — modelos ativos
Financeiro: DossieFinanceiro · DocumentoFinanceiro · ContaPagar · ContaReceber · Movimentacao · Fornecedor · Categoria
Estoque/Compras: Produto · MovimentacaoEstoque · PedidoCompra · ItemPedidoCompra
Auth/Sistema: Usuario · ConfiguracaoSistema · Notificacao · ImportacaoLote
Amazon: AmazonSyncLog · AmazonSyncJob · AmazonApiQuota · AmazonReviewSolicitation · AmazonSettlementReport · BuyBoxSnapshot · VendaAmazon · AmazonReembolso · LoteImportacaoFBA · VendaFBA · LoteMetricaGS · ProdutoMetricaGestorSeller
Ads: AdsGastoManual · AdsCampanha

## Regras de negócio críticas

### Documentos financeiros
- SHA256 único; reenvio retorna DUPLICADO. PDF protegido: `@libpdf/core` → texto → IA. Sem senha: input_file pra OpenAI. Imagem: input_image.
- Match boleto/NF: CNPJ, valor, vencimento, nº doc, linha digitável, chave acesso. Tolerância R$ 5 ou 0,2% (o maior).
- Boleto chega depois da NF → valor/vencimento do dossiê priorizam o boleto.
- Documento já pago via banco → cria conta PAGA com vencimento = `Movimentacao.dataCaixa`.

### Contas a pagar
- Abas: Abertas · Vencidas · Pagas · Todas. Filtros: Hoje · Ontem · 7d · 30d · Vitalício.
- Em Abertas/Todas "7d/30d" olha próximos vencimentos; em Vencidas/Pagas olha passados.

### Contas a receber (Amazon)
- CSV Unified Transaction: 9 linhas cabeçalho + nomes + 24 campos. `parseAmazonCSV` aceita string/Buffer/Uint8Array.
- Status: Liberado (já transferido) | Diferido (a receber). Diferido → ContaReceber PENDENTE por liquidação.
- Qualquer linha "Transferir" na liquidação = TRANSFERIDO. Reimportação parcial: `Math.max(existente, novo)`.
- Ciclo médio liquidação ~14d (`dataPrevisao = data última transação + 14d`).
- **Settlement automático**: job `SETTLEMENT_REPORT_SYNC` baixa CSV via Reports API a cada 6h.
- **Reconciliação Nubank**: `reconciliarRecebimentosAmazon()` cruza ENTRADA + descrição "Amazon" ↔ ContaReceber PENDENTE (R$ 5 ou 0,5%, ±3 dias). Roda a cada loop do worker.

### Pedidos Amazon (VendaAmazon)
- Chave única `(amazonOrderId, sku)`. Centavos sempre. `liquidoMarketplaceCentavos = valorBruto - (itemTax + shippingTax)`.
- **Backfill histórico**: job `REPORTS_BACKFILL` usa `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL` em janelas de 30d, cursor em `amazon_orders_history_cursor`, data inicial em `amazon_loja_aberta_em` (default 2025-07-28).
- Custos unitários: `Produto.custoUnitario Int?`. Front filtra "Com custo" por default (toggle).

## Worker daemon (alimentação 24/7)
- `npm run dev` → `scripts/dev.mjs` sobe `next dev --webpack` + `tsx scripts/amazon-worker.ts` em paralelo. Ctrl+C derruba ambos (Windows: `taskkill /T /F`).
- `npm run dev:web` (sem worker) · `npm run amazon:worker` (avulso) · `npm run amazon:worker:once` · `npm run amazon:test` (smoke SP-API)
- Heartbeat em `ConfiguracaoSistema.worker_heartbeat_at` a cada loop. Watchdog (`deploy/watchdog.sh`) reinicia se >5min.
- **Produção**: PM2 (`deploy/ecosystem.config.js`) gerencia `erp-web` + `erp-worker` separados — não use o wrapper.

### Schedules (`src/modules/amazon/jobs.ts`)
| Job | Intervalo | Notas |
|---|---|---|
| `ORDERS_SYNC` | 2min | últimos 3d, 1 página |
| `INVENTORY_SYNC` | 5min | snapshot FBA |
| `FINANCES_SYNC` | 30min | últimos 14d (preenche taxas/fretes em VendaAmazon via `breakdownAmount.currencyAmount`) |
| `REFUNDS_SYNC` | 1h | últimos 90d |
| `BUYBOX_CHECK` | 15min | rotaciona SKUs com ASIN |
| `CATALOG_REFRESH` | 24h | imagem, título, categoria |
| `SETTLEMENT_REPORT_SYNC` | 6h | CSV via Reports API |
| `REPORTS_BACKFILL` | 30min | janelas de 30d até alcançar `now-2d` (auto-desliga) |
| `REVIEWS_DISCOVERY` | 6h | descobre pedidos elegíveis (gateado por toggle, cache 30s) |
| `REVIEWS_SEND` | 1h | dispara solicitations |

### Rate limit adaptativo
- Defaults oficiais SP-API em `src/lib/amazon-rate-limit.ts`. `adoptObservedRateLimit()` calibra via header `x-amzn-RateLimit-Limit`.
- Cada operação tem cooldown em `AmazonApiQuota.nextAllowedAt`. 429 → `markAmazonOperationRateLimited()` (respeita `retry-after`); chamadas seguintes lançam `AmazonQuotaCooldownError` que vira retry.

### SP-API — roles
- OK: `Inventory and Order Tracking`, `Finance and Accounting`.
- Falta (causa 403): `Product Listing` (Catalog Items). `Pricing` recomendada.
- Habilitar em https://sellercentral.amazon.com/developer/applications. "Authorize again" gera novo refresh_token (atualizar em `/amazon`).

### Buybox — sellerId
- `runBuyboxCheck` lê `amazon_seller_id` (Seller Central → Settings → Account Info → Merchant Token). Setar via `npx tsx scripts/sync-seller-id.ts --set <ID>`. Sem ID, fallback heurístico de preço (50¢ tolerância).

## Notificações (sino)
- Modelo `Notificacao` (dedupeKey @unique). Helpers em `src/lib/notificacoes.ts`.
- Tipos: `ESTOQUE_CRITICO` · `BUYBOX_PERDIDO/RECUPERADO` · `REEMBOLSO_ALTO` · `ACOS_ALTO` · `LIQUIDACAO_ATRASADA` · `CUSTO_AUSENTE` · `JOB_FALHANDO` · `QUOTA_BLOQUEADA` · `SETTLEMENT_NOVO` · `RECEBIMENTO_RECONCILIADO` · `WORKER_REINICIADO`.

## Criptografia de credenciais
- `src/lib/crypto.ts` AES-256-GCM. Master em `CONFIG_ENCRYPTION_KEY` (32 bytes hex).
- `saveAmazonConfig()` cripta automaticamente chaves contendo `secret|token|password|senha|_key|_apikey`. `getAmazonConfig()` descripta. Valores legados em texto puro continuam OK.

## Arquivos de referência (não apagar)
- MARTINS_9349830.pdf (senha: 10338212), 8f0c1001-…pdf — par boleto/NF protegido
- NU_4699049964_*.csv/.ofx — extratos Nubank (ago/2025–abr/2026)
- 2026MarMonthlyUnifiedTransaction.csv (329) · 2026Apr1-2026Apr15CustomUnifiedTransaction(.csv|(1).csv) (123)

## Rotas principais
- **Público**: `/api/health` (db, worker.lastHeartbeatAt, queue, quota.cooldowns, lastSync)
- Contas: `/api/contas` (GET filtros · POST) · `[id]` (PATCH/DELETE) · `[id]/pagar` POST `{pagoEm}` · `[id]/reverter`
- A receber: `/api/contas-a-receber` (?status) · `/totais` · `/importar-amazon` (multipart) · `[id]/marcar-recebida`
- Estoque: `/api/estoque/produtos` (?ativo, ?temCusto, ?busca) · `[id]` · `[id]/movimentacoes` · `/totais` · `/importar`
- Caixa/Documentos/Compras totais: `/api/caixa/totais` · `/api/contas/totais` · `/api/documentos-financeiros/totais` · `/api/compras/totais`
- Compras: `/api/compras` · `[id]` · `[id]/confirmar` (cria ContaPagar) · `[id]/receber` (cria entrada estoque) · `/sugestoes`
- DRE: `/api/dre/resumo` (?de, ?ate, ?modo, ?ano) — blocos `amazon`, `cpv`, `ads`
- Destinação: `/api/destinacao/resumo`
- Amazon: `/api/amazon/{config,sync,status,jobs,quota,worker,sync-buybox,sync-catalog,sync-settlement}` · `/reviews/{config,produtos,metricas}` · `/api/sistema/db-stats`
- Auth: LWA OAuth2 (refresh_token → access_token, header `x-amz-access-token`). Sem AWS SigV4.

## Next.js 16 — params assíncrono (CRÍTICO)
```ts
type Params = { params: Promise<{ id: string }> };
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params; // NUNCA params.id direto
}
```

## Categorias contas a pagar
Compra de mercadorias/produtos · Fretes e entregas · Contabilidade · Impostos · Marketing · Despesas operacionais · Serviços terceirizados · Tecnologia e sistemas · Taxas de plataformas/pagamentos

## UI compartilhado
- `src/components/ui/kpi-card.tsx` — `<KpiCard label value sub? icon? color?/>`. Cores: blue|green|red|orange|violet|slate. Usado em Dashboard, Caixa, Contas a Pagar, A Receber, NFs, Destinação, DRE, Avaliações. Sempre preferir o compartilhado.

## Avaliações (`/avaliacoes`)
- Toggle master `automacaoAtiva` em `ConfiguracaoSistema` é a chave: enquanto ON e worker rodando, `REVIEWS_DISCOVERY` (6h) e `REVIEWS_SEND` (1h) são enfileirados pelo scheduler. Cache 30s no scheduler.
- 5 KPIs: Pedidos 30d · Sucesso 30d · Enviadas hoje · Adiados · Erros. Abas: Geral & Histórico (com filtros) · Por Produto.

## Destinação UX
Inputs clampam em 100 − soma_outras no onChange. Badge "X% / 100%" no header. `aria-live` com mensagem. Salvar disabled <100. Backend valida em `setPercentuais()`.

## Preferências do usuário
- Sem redesign radical. Melhorias incrementais. Botões/modais > blocos fixos. Protótipo antes de mudanças visuais grandes.
- Fluxo de documentos sem duplicidade. Alertas APENAS no sino (sem email/Slack/Telegram).

## Deploy — VPS Hostinger (`deploy/`)
Postgres 16 self-hosted + Nginx + Let's Encrypt + PM2 + cron. Domínio `mundofs.cloud` (institucional); ERP em subdomínio (sugestão `erp.mundofs.cloud`). Arquivos: `install-server.sh`, `postgres-setup.sql`, `nginx-erp.conf` (443→3000), `ecosystem.config.js` (PM2 erp-web + erp-worker), `systemd/pm2-erp.service`, `backup-postgres.sh` (pg_dump 14d+8w), `watchdog.sh` (cron 5min), `crontab.example`. Sequência em `deploy/README.md`. `vercel.json` removido.

## SQS (opcional, push real-time)
Esqueleto `src/lib/amazon-sqs.ts`. Liga com `AMAZON_SQS_QUEUE_URL` + `AWS_ACCESS_KEY_ID/SECRET`. Mapeia `ORDER_CHANGE→ORDERS_SYNC`, `ANY_OFFER_CHANGED→BUYBOX_CHECK`, `FBA_INVENTORY_*→INVENTORY_SYNC`, `REPORT_PROCESSING_FINISHED→SETTLEMENT_REPORT_SYNC`.

## Scripts npm
| Script | Função |
|---|---|
| `dev` / `dev:web` / `dev:turbopack` / `dev:clean` | dev (web+worker / só web / turbopack / limpa .next) |
| `build` / `start` | produção |
| `amazon:worker[:once]` / `amazon:test` | worker / smoke SP-API |
| `prisma:generate` / `prisma:push` (SQLite dev) / `prisma:migrate` (Postgres dev) / `prisma:migrate:deploy` (prod) | Prisma |
| `migrate:sqlite-to-postgres` | one-shot (instala `better-sqlite3` antes) |
| `db:seed` · `lint` · `typecheck` · `test[:watch]` | utilitários |

## Processo ao alterar Prisma
1. Encerrar Next se rodando (verifica PID antes).
2. SQLite: `npm run prisma:generate && npm run prisma:push` · Postgres dev: `npm run prisma:migrate -- --name <nome>`.
3. Reiniciar. Em prod: `npm run prisma:migrate:deploy`.

## Validação — só no que mudou
- Lint: `npx eslint <arquivo>` · Typecheck: `npx tsc --noEmit` · Testes: `npx vitest run <arquivo>`
- `npm run build` somente quando explicitamente solicitado ou antes de deploy. NUNCA `npm run test` cego após cada comando.
