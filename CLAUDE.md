# Contexto — ERP Amazon

## Stack
- Next.js 16.2.4 App Router · TypeScript · Prisma 5.22 · React 18 · pino · recharts · lucide-react · Radix
- **Banco duplo**: SQLite local (`prisma/schema.prisma` → `prisma/dev.db`) · Postgres prod (`prisma/schema.postgresql.prisma`). Scripts Postgres têm suffix `:pg`.
- Dinheiro em centavos (`Int`). Fuso `America/Sao_Paulo`. Logger `pino` em `src/lib/logger.ts` — sem `console.log`.
- ESLint flat (`eslint.config.mjs`). `next.config.mjs` com `typedRoutes: true`.

## Schema — modelos ativos
- Financeiro: DossieFinanceiro · DocumentoFinanceiro · ContaPagar · ContaReceber · Movimentacao · Fornecedor · Categoria
- Estoque/Compras: Produto · MovimentacaoEstoque · PedidoCompra · ItemPedidoCompra
- Auth/Sistema: Usuario · ConfiguracaoSistema · Notificacao · ImportacaoLote
- Amazon: AmazonSyncLog · AmazonSyncJob · AmazonApiQuota · AmazonReviewSolicitation · AmazonSettlementReport · BuyBoxSnapshot · VendaAmazon · AmazonReembolso · LoteImportacaoFBA · VendaFBA · LoteMetricaGS · ProdutoMetricaGestorSeller · AmazonAdsMetricaDiaria · AmazonSkuTrafficDaily · AmazonOrderRaw
- Ads: AdsGastoManual · AdsCampanha

## Regras de negócio

### Documentos financeiros
SHA256 único (reenvio = DUPLICADO). PDF protegido: `@libpdf/core` → texto → IA. Sem senha: `input_file`. Imagem: `input_image`. Match boleto/NF: CNPJ, valor, vencimento, nº doc, linha digitável, chave. Tolerância R$5 ou 0,2% (o maior). Boleto após NF → valor/vencimento do boleto priorizam. Doc já pago via banco → conta PAGA com vencimento = `Movimentacao.dataCaixa`.

### Contas a pagar
Abas: Abertas · Vencidas · Pagas · Todas. Filtros: Hoje · Ontem · 7d · 30d · Vitalício. Em Abertas/Todas "7d/30d" = próximos; em Vencidas/Pagas = passados.

### Contas a receber (Amazon)
CSV Unified Transaction: 9 linhas cabeçalho + nomes + 24 campos. Status Liberado (transferido) | Diferido (PENDENTE por liquidação). Reimport parcial: `Math.max(existente, novo)`. Ciclo ~14d (`dataPrevisao = data última + 14d`). Job `SETTLEMENT_REPORT_SYNC` (6h) baixa CSV via Reports API. `reconciliarRecebimentosAmazon()` cruza ENTRADA Nubank + "Amazon" ↔ ContaReceber PENDENTE (R$5 ou 0,5%, ±3d) a cada loop do worker.

### VendaAmazon (espelha Gestor Seller)
Chave única `(amazonOrderId, sku)`. `liquidoMarketplaceCentavos = valorBruto - itemTax - shippingTax`. Filtro **`whereVendaAmazonEspelhoGestorSeller()`** em `src/modules/vendas/filtros.ts` é a fonte de verdade (substituiu `whereVendaAmazonContabilizavel`). KPIs do dashboard preferem snapshot em `ConfiguracaoSistema` (chave `gestor_seller_snapshot:<de>:<ate>`) com fallback para agregação local. Backfill: `REPORTS_BACKFILL` em janelas de 30d, cursor `amazon_orders_history_cursor`, início `amazon_loja_aberta_em` (default 2025-07-28). `Produto.custoUnitario Int?` — front filtra "Com custo" por default.

### Reembolsos (finance pipeline)
`src/modules/amazon/finance-normalizer.ts` converte `SPFinanceTransaction` em `NormalizedFinanceTransaction` (item-level: SKU/ASIN/qty/fees/promos; transaction-level: settlementId/refundId). `finance-materializer.ts` aplica ações `CRIAR_REEMBOLSO | ATUALIZAR_REEMBOLSO | MARCAR_VENDA_REEMBOLSADA | IGNORAR` em `AmazonReembolso`+`VendaAmazon`. Auditoria: `npm run amazon:reliability:audit` (7 checks: refunds, gestor-seller, removals, pending-zero, finance-denormalized, api-conflicts, order-id). Recovery: `npx tsx scripts/recover-zero-pending.ts --apply` (default `--dry-run`).

### Ads (fonte única)
`src/modules/amazon/ads-aggregation.ts` centraliza tudo. Precedência: **SYNC** (AmazonAdsMetricaDiaria > 0) > **LEGACY+MANUAL** (AdsCampanha CSV + AdsGastoManual) > **VAZIO**. Helpers puros (ACOS/ROAS/CTR/CPC/conv). Endpoints `/api/ads/*` e service dashboard consomem essa camada.

### Buybox
`runBuyboxCheck` lê `amazon_seller_id` (Seller Central → Settings → Merchant Token). Set via `npx tsx scripts/sync-seller-id.ts --set <ID>`. Sem ID, fallback heurístico (50¢ tolerância).

## Worker daemon
- Local: `npm run dev` sobe Next + worker em paralelo (`scripts/dev.mjs`). `dev:web` sem worker. `amazon:worker[:once]` avulso.
- Prod: PM2 (`deploy/ecosystem.config.js`) — 3 processes: `erp-web` · `erp-worker` · `erp-sqs-consumer`.
- Heartbeat em `ConfiguracaoSistema.worker_heartbeat_at` a cada loop. Watchdog (`deploy/watchdog.sh` cron 5min) reinicia se >5min.

### Schedules (`src/modules/amazon/jobs.ts`)
| Job | Intervalo | Notas |
|---|---|---|
| ORDERS_SYNC | 2min | últimos 3d, 1 página |
| INVENTORY_SYNC | 5min | snapshot FBA |
| FINANCES_SYNC | 30min | últimos 14d, preenche taxas/fretes via `breakdownAmount.currencyAmount` |
| REFUNDS_SYNC | 1h | últimos 90d, usa finance-materializer |
| BUYBOX_CHECK | 15min | rotaciona SKUs com ASIN |
| CATALOG_REFRESH | 24h | imagem/título/categoria |
| SETTLEMENT_REPORT_SYNC | 6h | CSV via Reports API |
| REPORTS_BACKFILL | 30min | janelas 30d até `now-2d` (auto-desliga) |
| REVIEWS_DISCOVERY | 6h | gateado por `automacaoAtiva`, cache 30s |
| REVIEWS_SEND | 1h | dispara solicitations |

### SP-API & rate limit
LWA OAuth2 (refresh_token → access_token, header `x-amz-access-token`). Sem AWS SigV4. Defaults em `src/lib/amazon-rate-limit.ts`; `adoptObservedRateLimit()` calibra via `x-amzn-RateLimit-Limit`. Cooldown em `AmazonApiQuota.nextAllowedAt`. 429 → `markAmazonOperationRateLimited()` respeita `retry-after`; lança `AmazonQuotaCooldownError` (retry). **Roles OK**: Inventory and Order Tracking, Finance and Accounting. **Faltam (403)**: Product Listing (Catalog Items), Pricing.

## Notificações (sino — sem email/Slack/Telegram)
Modelo `Notificacao` (dedupeKey @unique). Helpers `src/lib/notificacoes.ts`. Tipos: ESTOQUE_CRITICO · BUYBOX_PERDIDO/RECUPERADO · REEMBOLSO_ALTO · ACOS_ALTO · LIQUIDACAO_ATRASADA · CUSTO_AUSENTE · JOB_FALHANDO · QUOTA_BLOQUEADA · SETTLEMENT_NOVO · RECEBIMENTO_RECONCILIADO · WORKER_REINICIADO.

## Criptografia
`src/lib/crypto.ts` AES-256-GCM. Master em `CONFIG_ENCRYPTION_KEY` (32 bytes hex). `saveAmazonConfig()` cripta chaves matching `secret|token|password|senha|_key|_apikey`. Legado em texto puro ainda lido.

## Next.js 16 — params assíncrono (CRÍTICO)
```ts
type Params = { params: Promise<{ id: string }> };
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params; // NUNCA params.id direto
}
```

## UI compartilhado (`src/components/ui/`)
- **`kpi-card.tsx`** — KPI básico (label/value/sub/icon, cores blue|green|red|orange|violet|slate). Para o dashboard e-commerce há custom inline com `borderColor` por categoria.
- **`product-thumb.tsx`** — thumb 32/40/48/56px com fallback `ImageOff`. Usa `resolverImagemProduto()` de `src/lib/amazon-images.ts` (ordem: imagemUrl manual → amazonImagemUrl → imagemDoAsin).
- **`margin-badge.tsx`** — pílula colorida automática: verde ≥25% · âmbar 10-24% · vermelho <10% · slate N/A.
- **`trend-indicator.tsx`** — TrendingUp/Down (lucide) com polaridade invertível (custos = positivo é ruim).
- Outros: `badge` · `card` · `dialog` · `popover` · `tooltip` · `table` · `skeleton` · `sonner` (toasts).

## Dashboard E-commerce (`/dashboard-ecommerce`)
Layout 8 KPIs primários + "Ver mais 8" secundários (toggle). Bordas laterais coloridas por categoria: **receita=verde** (Faturamento, Líq.Marketplace) · **operação=azul** (Lucro, Margem, Vendas, Unidades, Ticket, ROI) · **ads=âmbar** · **tráfego=violeta**. Chart "Resumo de receitas" = 3 áreas empilhadas (Faturamento violeta + Líq.Marketplace azul + Lucro emerald). Top 15 com `ProductThumb` 40px + `MarginBadge`. Filtro de período no header (inline). Service `obterTopProdutos` expõe `imagemUrl/amazonImagemUrl/asin`; `obterTimeline` inclui `liquidoMarketplaceCentavos`.

## Preferências do usuário
Sem redesign radical — incrementais. Protótipo HTML antes de mudanças visuais grandes (ver `mockups/`). Botões/modais > blocos fixos. Fluxo sem duplicidade. Alertas APENAS no sino.

## Deploy — VPS Hostinger
- Host SSH: alias `erp-vps` → `srv1611537.hstgr.cloud:2222`, user `mundofs`, key `~/.ssh/id_ed25519_mundofs_vps`.
- Path app: `/opt/erp-amazon` (owner `erp`). Stack: Postgres 16 self-hosted + Nginx (443→3000) + PM2 + cron + Let's Encrypt. Domínio `erp.mundofs.cloud`.
- **Sequência de deploy** (rodar como `mundofs`, com `sudo -u erp`):
  ```bash
  cd /opt/erp-amazon && \
  git stash push --include-untracked -m "pre-deploy-$(date +%s)" && \
  git pull --ff-only origin main && \
  npm install --no-audit --no-fund && \
  npm run prisma:migrate:deploy:pg && \
  rm -rf .next && npm run build && \
  pm2 reload erp-web erp-worker erp-sqs-consumer
  ```
- Após build: atualizar `GIT_SHA` em `.env` (`git rev-parse --short HEAD`) e `pm2 reload erp-web --update-env` para refletir em `/api/health`.
- Rollback: `git reset --hard <sha-anterior> && npm run build && pm2 reload erp-web erp-worker erp-sqs-consumer`.

## Cuidados especiais (gotchas)
- **OneDrive corrompe `.git`** — nunca abrir o repo em pasta sincronizada (`mmap failed: Invalid argument` em fetch). Use `c:\Projects\` ou similar.
- **Schema duplo**: prod usa `prisma:migrate:deploy:pg` (com `--schema prisma/schema.postgresql.prisma`). NÃO usar `prisma:migrate:deploy` sem `:pg` em prod (vai apontar pro schema SQLite).
- **SQS opcional**: liga com `AMAZON_SQS_QUEUE_URL` + `AWS_ACCESS_KEY_ID/SECRET`. Mapeia `ORDER_CHANGE→ORDERS_SYNC`, `ANY_OFFER_CHANGED→BUYBOX_CHECK`, `FBA_INVENTORY_*→INVENTORY_SYNC`, `REPORT_PROCESSING_FINISHED→SETTLEMENT_REPORT_SYNC`.

## Validação — só no que mudou
- Lint: `npx eslint <arquivo>` · Typecheck: `npx tsc --noEmit` · Testes: `npx vitest run <arquivo>`
- `npm run build` somente quando solicitado ou antes de deploy. NUNCA `npm run test` cego.

## Processo ao alterar Prisma
1. Encerrar Next (verifica `.dev-server.pid`).
2. Dev SQLite: `npm run prisma:generate && npm run prisma:push`. Dev Postgres: `npm run prisma:migrate:pg -- --name <nome>`.
3. Reiniciar. Prod: `npm run prisma:migrate:deploy:pg`.
