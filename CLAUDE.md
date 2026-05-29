# Contexto — Atlas Seller (ERP Amazon)

Marca visual = **Atlas Seller** (rebrand do "ERP Amazon"). Logo MundoFS em `public/atlas-symbol.png` (símbolo) e `public/logo-mundofs.png` (full). Componente `src/components/brand-mark.tsx` é a fonte única do branding na sidebar/topbar. Rota raiz `/` redireciona para `/dashboard-ecommerce` (não `/home`).

## Stack
- Next.js 16.2.4 App Router · TypeScript · Prisma 5.22 · React 18 · pino · recharts · lucide-react · Radix
- **Banco duplo**: SQLite local (`prisma/schema.prisma` → `prisma/dev.db`) · Postgres prod (`prisma/schema.postgresql.prisma`). Scripts Postgres têm suffix `:pg`.
- Dinheiro em centavos (`Int`). Fuso `America/Sao_Paulo`. Logger `pino` em `src/lib/logger.ts` — sem `console.log`.
- ESLint flat (`eslint.config.mjs`). `next.config.mjs` com `typedRoutes: true`.

## Schema — modelos ativos
- Financeiro: DossieFinanceiro · DocumentoFinanceiro · ContaPagar · ContaReceber · Movimentacao · Fornecedor · Categoria
- Estoque/Compras: Produto · MovimentacaoEstoque · PedidoCompra · ItemPedidoCompra
- Auth/Sistema: Usuario · ConfiguracaoSistema · Notificacao · ImportacaoLote
- Amazon: AmazonSyncLog · AmazonSyncJob · AmazonApiQuota · AmazonReviewSolicitation · AmazonSettlementReport · BuyBoxSnapshot · VendaAmazon · VendaCustoEventual · AmazonReembolso · LoteImportacaoFBA · VendaFBA · LoteMetricaGS · ProdutoMetricaGestorSeller · AmazonAdsMetricaDiaria · AmazonSkuTrafficDaily · AmazonOrderRaw · AmazonFeeEstimate · AmazonFinanceTransaction
- Custo histórico: ProdutoCustoHistorico (vigências por data)
- Ads: AdsGastoManual · AdsCampanha
- WhatsApp Estoque: WhatsAppEstoqueEnvio (histórico de envios) · WhatsAppEstoqueProdutoExcluido (produtos fora do resumo)
- Agenda: Tarefa (empresa/pessoal, responsável único) · ContaFixa (recorrente/não recorrente). Ocorrências de conta fixa vivem em `ContaPagar` (`contaFixaId` + `competencia` "YYYY-MM", com `@@unique([contaFixaId, competencia])`).

## Regras de negócio

### Documentos financeiros
SHA256 único (reenvio = DUPLICADO). PDF protegido: `@libpdf/core` → texto → IA. Sem senha: `input_file`. Imagem: `input_image`. Match boleto/NF: CNPJ, valor, vencimento, nº doc, linha digitável, chave. Tolerância R$5 ou 0,2% (o maior). Boleto após NF → valor/vencimento do boleto priorizam. Doc já pago via banco → conta PAGA com vencimento = `Movimentacao.dataCaixa`.

### Contas a pagar
Abas: Abertas · Vencidas · Pagas · Todas. Filtros: Hoje · Ontem · 7d · 30d · Vitalício. Em Abertas/Todas "7d/30d" = próximos; em Vencidas/Pagas = passados. Botão "Contas fixas" abre `<DialogContasFixas>` (gestão); ocorrências de conta fixa aparecem na lista com selo "fixa".

### Agenda (`/agenda` — tarefas + contas fixas)
Área central de organização. Módulos: `src/modules/tarefas/` (CRUD + visibilidade), `src/modules/contas-fixas/` (recorrência pura + ocorrências idempotentes), `src/modules/agenda/` (agregação por período). UI: `src/components/agenda/` (`agenda-view` calendário do mês + lista do dia + backlog "sem prazo" + chips de filtro; `dialog-tarefa`; `dialog-contas-fixas`). Item na sidebar (grupo Financeiro).
- **Tarefas**: título, descrição, prazo (opcional → backlog), status ABERTA/CONCLUIDA/CANCELADA, visibilidade EMPRESA/PESSOAL, responsável único. **Segurança (anti-IDOR)**: PESSOAL só é visível/editável pelo dono — aplicado no SERVER (`whereTarefasVisiveis`/`podeVerTarefa` em `tarefas/visibilidade.ts`, e `buscarVisivel` no repo). Criar/editar PESSOAL força `responsavelId = session.uid`. Endpoints `/api/tarefas` (POST), `/api/tarefas/[id]` (PATCH/DELETE), `/api/tarefas/[id]/concluir` (POST) — `requireSession`. Lookup nunca revela existência de tarefa alheia (404).
- **Contas fixas**: descrição, valor (centavos), `diaVencimento` (1..31, clampa ao último dia do mês — ex: 31 em fev → 28/29), recorrente/não, categoria/fornecedor opcionais, ativa. Recorrência pura em `contas-fixas/recorrencia.ts` (`planejarOcorrencias`, `vencimentoDaCompetencia` ao meio-dia UTC). `garantirOcorrencias({de,ate})` materializa em `ContaPagar` de forma **idempotente** (set de existentes + `@@unique`), **clampando o intervalo a 400 dias** (anti-DoS, pois roda em GET da agenda). Não recorrente → 1 ocorrência na competência escolhida (`ContaFixa.competenciaUnica`; UI usa date picker de data completa, fallback = mês de criação para registros antigos). Categoria/fornecedor ausentes usam sentinela "Contas Fixas". Editar com `sincronizarFuturas: true` propaga valor/vencimento/descrição às ocorrências **futuras em aberto** (`sincronizarOcorrenciasFuturas`: atualiza competências ainda planejadas, soft-delete + zera `competencia` nas que saíram do plano; **nunca toca em PAGA**). Endpoints `/api/contas-fixas` (GET/POST), `/api/contas-fixas/[id]` (PATCH/DELETE=desativar), `/api/contas-fixas/ocorrencias` (POST) — `requireRole(ADMIN, FINANCEIRO)`.
- **`/api/agenda`** (`requireSession`): agrega tarefas visíveis + ocorrências do período em `AgendaItem[]` com `statusAgenda` derivado (ABERTA/VENCIDA/CONCLUIDA/CANCELADA). Filtros: tipos (TAREFA_EMPRESA/PESSOAL/MINHAS, CONTA_FIXA) + status (CSV).

### Contas a receber (Amazon)
CSV Unified Transaction: 9 linhas cabeçalho + nomes + 24 campos. Status Liberado (transferido) | Diferido (PENDENTE por liquidação). Reimport parcial: `Math.max(existente, novo)`. Ciclo ~14d (`dataPrevisao = data última + 14d`). Job `SETTLEMENT_REPORT_SYNC` (6h) baixa CSV via Reports API. `reconciliarRecebimentosAmazon()` cruza ENTRADA Nubank + "Amazon" ↔ ContaReceber PENDENTE (R$5 ou 0,5%, ±3d) a cada loop do worker.

### VendaAmazon (independente de Gestor Seller)
Chave única `(amazonOrderId, sku)`. `liquidoMarketplaceCentavos = valorBruto - taxasCentavos - fretesCentavos`. Filtro **`whereVendaAmazonEspelhoGestorSeller()`** em `src/modules/vendas/filtros.ts` filtra cancelados + Removal Orders + Pending sem valor. Backfill: `REPORTS_BACKFILL` em janelas de 30d, cursor `amazon_orders_history_cursor`, início `amazon_loja_aberta_em` (default 2025-07-28). `Produto.custoUnitario Int?` (fallback) + `ProdutoCustoHistorico` (vigências por data — fonte de verdade do custo). Custo resolvido via `resolverCustoUnitario(produtoId, dataVenda)`.

**Invariante crítico — `VendaAmazon.taxasCentavos` é APENAS REAL** (Finance API ou SP-API Orders). Estimativas NUNCA são persistidas aqui — vivem apenas em memória no service do dashboard. DRE/Contas a Receber estão protegidos via `whereVendaAmazonContabilizavelEstrito()` que exclui PENDENTE. Write sites em `service.ts`: bloco de Orders (~L788 e L882-884) e bloco de Finance (~L1127/L1202).

### Fee Estimator (taxas Amazon estimadas, v2)
- Módulo `src/modules/produtos/fee-estimator.ts` com **tabela COMMISSION_TABLE** de 36 categorias BR (rateBps + minCentavos + tier opcional). Tiers: Móveis 15%/10% acima R$200, Acessórios eletrônicos 15%/10% acima R$100.
- **Closing fee R$1.99** para mídia (Livros/DVD/Música/Games).
- **3 camadas de cache**: (1) Map memory in-process TTL 5min · (2) `AmazonFeeEstimate` Postgres (populado por job 1h) · (3) fallback local puro.
- **Promo FBA** R$5 (≤R$99.99) / R$0 (≥R$100) válida até **31/07/2026** (config em `ConfiguracaoSistema.amazon_fee_fba_promo_*`). Job `AMAZON_FBA_PROMO_EXPIRY_CHECK` (24h) dispara Notificação `CONFIG_REVIEW` quando expirar.
- **Default global = 12%** (`amazon_fee_referral_default_bps=1200`) calibrado pelas planilhas do user; só usado quando `Produto.amazonCategoriaFee` é null.
- **Parcelamento NÃO é estimado** — vem real via sub-breakdown `AmazonForAllFee` dentro de `AmazonFees` no Finance API (1.5% sobre vendas ≥ R$40).
- **Estado prod**: `AmazonFeeEstimate` populado lentamente por `AMAZON_FEE_ESTIMATE_SYNC` (batch 5 SKUs/h com delay 3s, fail-fast quando quota PRODUCT_FEES_ESTIMATE em cooldown). Amazon enforces quota agressiva → cache opera majoritariamente em fallback local.

### Snapshot Gestor Seller (LEGADO — removido)
Foi removido em 2c349dc. Sistema opera 100% standalone com VendaAmazon + ProdutoCustoHistorico + fee-estimator.

### Vendas (`/vendas` — UI redesenhada V5)
- Cards expansíveis substituem a tabela. Um card = uma linha `VendaAmazon` (chave `amazonOrderId+sku`). Pedidos multi-SKU viram múltiplos cards.
- Header do card: status + data/hora + logística + `MarketplaceTag` (pílula com smile da Amazon). Layout interno do item em 2 linhas responsivas (md:grid-cols-5 / sm:grid-cols-3 / mobile:grid-cols-2) — **zero scroll horizontal**.
- Painel expandido mostra `OrderCardBreakdown` (comissão/FBA/parcelamento/frete/imposto/custo/lucro) via `montarBreakdownVendas` em [src/modules/vendas/breakdown.ts](src/modules/vendas/breakdown.ts). 5 queries Prisma em paralelo (vendas + produtos + custos históricos + fee estimates + **custos eventuais**). Helpers privados de `service.ts` (`findTopBreakdownAmount`/`sumBreakdowns`) NUNCA importar — usar [src/modules/vendas/breakdown-parser.ts](src/modules/vendas/breakdown-parser.ts) isolado.
- Filtros como chips toolbar (`<FiltrosToolbar>`): Período (presets idênticos ao Dashboard E-commerce, reusa `<FiltroPeriodo>` + `src/lib/periodo.ts`) · Logística (FBA/FBM) · Status (multi-select) · SKU · "Limpar".
- API `/api/vendas` e `/api/vendas/totais` aceitam os MESMOS filtros (preset, sku, logistica, statuses CSV) — KPIs no topo precisam reagir a todos os chips, não só ao período.
- Lookup de produto é por `sku` (em batch), não por `produtoId` — `VendaAmazon` não tem `produtoId`.

### Custos eventuais por venda
- Modelo `VendaCustoEventual` (cascade com `VendaAmazon`) guarda custos avulsos lançados manualmente (ex: frete devolução). **NÃO toca os campos sagrados** de `VendaAmazon`.
- Endpoints: `POST/GET /api/vendas/[vendaId]/custos-eventuais` e `DELETE /api/vendas/[vendaId]/custos-eventuais/[custoId]`. Validação Zod.
- Soma agregada em `breakdown.custoExtraCentavos` e subtrai do lucro. UI: `<DialogCustoEventual>` dentro do painel expandido do card.

### Marketplace normalizer
- [src/lib/amazon-marketplace.ts](src/lib/amazon-marketplace.ts) mapeia marketplaceId cru (`A2Q3Y263D00KWC`, `ATVPDKIKX0DER`, …) → domínio amigável (`amazon.com.br`, `amazon.com`, …). Default vazio = `amazon.com.br` (ERP single-marketplace BR).
- `<MarketplaceTag>` em [src/components/vendas/marketplace-tag.tsx](src/components/vendas/marketplace-tag.tsx) aplica o normalizador + SVG inline do smile laranja `#FF9900`.

### Reembolsos (finance pipeline)
`src/modules/amazon/finance-normalizer.ts` converte `SPFinanceTransaction` em `NormalizedFinanceTransaction` (item-level: SKU/ASIN/qty/fees/promos; transaction-level: settlementId/refundId). `finance-materializer.ts` aplica ações `CRIAR_REEMBOLSO | ATUALIZAR_REEMBOLSO | MARCAR_VENDA_REEMBOLSADA | IGNORAR` em `AmazonReembolso`+`VendaAmazon`. Recovery: `npx tsx scripts/recover-zero-pending.ts --apply` (default `--dry-run`). Audit `amazon:reliability:audit` foi removido (legado).

### Ads (fonte única)
`src/modules/amazon/ads-aggregation.ts` centraliza tudo. Precedência: **SYNC** (AmazonAdsMetricaDiaria > 0) > **LEGACY+MANUAL** (AdsCampanha CSV + AdsGastoManual) > **VAZIO**. Helpers puros (ACOS/ROAS/CTR/CPC/conv). Endpoints `/api/ads/*` e service dashboard consomem essa camada.

### Buybox
`runBuyboxCheck` lê `amazon_seller_id` (Seller Central → Settings → Merchant Token). Set via `npx tsx scripts/sync-seller-id.ts --set <ID>`. Sem ID, fallback heurístico (50¢ tolerância).

### Resumo diário de estoque (WhatsApp via WAHA)
Módulo isolado `src/modules/whatsapp-estoque/` (`service.ts` cálculo · `message.ts` formatação · `waha-client.ts` HTTP · `jobs.ts` orquestração · `config.ts` · `schemas.ts`). Envia 1 resumo/dia de cobertura de estoque às **10:00** (`America/Sao_Paulo`).
- **Cobertura** = `estoqueAtual / mediaDia`, `mediaDia = vendas 30d / 30` (vendas via `whereVendaAmazonContabilizavelEstrito()` + `groupBy sku`). Lookup de produto por `sku` (batch).
- **Faixas** (`FaixaEstoque`, por dias de cobertura com floor): CRITICO <16 · ATENCAO 16–30 · ESTAVEL 31–59 · SEGURO ≥60. Ordena globalmente por menor cobertura; agrupa por faixa.
- **Exclui**: produtos sem venda nos últimos 30d + excluídos manualmente (`WhatsAppEstoqueProdutoExcluido`). **NÃO** usa `Produto.estoqueMinimo`.
- **Mensagem**: cabeçalho com data/hora local + seções por faixa; quebra em partes numeradas (`Parte i/n`) quando excede o limite do WhatsApp.
- **Config** em `ConfiguracaoSistema` (chaves `whatsapp_estoque_*`): `ativo`, `horario`, `destinatario`, `waha_url`, `waha_session` (default `default`), `waha_api_key` (cifrada AES-256-GCM; `isSecretConfigKey` por sufixo `_key`). API key mascarada na UI (`********`) — save preserva quando o valor contém `*`. UI em `/configuracoes` → Integrações (`whatsapp-estoque-section.tsx`): switch, campos, "Enviar teste agora", status do último envio, exclusão/reativação de produtos.
- **Envio** (`runWhatsappEstoqueResumo`): NUNCA lança; registra `WhatsAppEstoqueEnvio` (ENVIANDO→SUCESSO/ERRO/SKIPPED). Falha no envio `DIARIO` → Notificação `CONFIG_REVIEW` (dedupe por dia). Tipo `TESTE` (botão da UI) não notifica. Endpoints sob `/api/configuracoes/whatsapp-estoque/*` (ADMIN), incluindo `enviar-teste` e gestão de produtos excluídos.
- **WAHA**: `waha-client.ts` faz `POST {url}/api/sendText` com header `X-Api-Key`; `normalizarChatId` (número cru → `@c.us`, preserva `@g.us`/`@c.us`), `mascararDestino` (últimos 4 dígitos). Container do WAHA em `deploy/waha-whatsapp-estoque.md`.

## Worker daemon
- Local: `npm run dev` sobe Next + worker em paralelo (`scripts/dev.mjs`). `dev:web` sem worker. `amazon:worker[:once]` avulso.
- Prod: PM2 (`deploy/ecosystem.config.js`) — 3 processes: `erp-web` · `erp-worker` · `erp-sqs-consumer`.
- Heartbeat em `ConfiguracaoSistema.worker_heartbeat_at` a cada loop. Watchdog (`deploy/watchdog.sh` cron 5min) reinicia se >5min.

### Schedules (`src/modules/amazon/jobs.ts`)
| Job | Intervalo | Notas |
|---|---|---|
| ORDERS_SYNC | 2min | últimos 3d, 1 página |
| INVENTORY_SYNC | 2min | snapshot FBA |
| FINANCES_SYNC | 15min | últimos 14d, lê `breakdownAmount` agregado de `AmazonFees` (inclui Commission+FBA+Tax+AmazonForAllFee/parcelamento) |
| FINANCES_BACKFILL | 30min | janelas 14d, cursor `amazon_finances_backfill_cursor`. Gate em jobs.ts pula enfileiramento quando cursor ≥ `now-13d` (dentro da cobertura do FINANCES_SYNC). |
| REFUNDS_SYNC | 30min | últimos 90d, usa finance-materializer |
| BUYBOX_CHECK | 10min | rotaciona SKUs com ASIN |
| CATALOG_REFRESH | 24h | imagem/título/categoria |
| SETTLEMENT_REPORT_SYNC | 6h | CSV via Reports API |
| REPORTS_BACKFILL | 30min | janelas 30d até `now-2d` (auto-desliga interno) |
| REVIEWS_DISCOVERY | 12h | gateado por `automacaoAtiva`, cache 30s |
| REVIEWS_SEND | 1h | dispara solicitations |
| LISTING_PRICE_SYNC | 30min | cache `Produto.amazonPrecoListagemCentavos` (fallback Pending sem ItemPrice) |
| AMAZON_FEE_ESTIMATE_SYNC | 1h | batch 5 SKUs com delay 3s. Gate `isProductFeesQuotaSaturated` pula quando cooldown >5min. |
| AMAZON_FBA_PROMO_EXPIRY_CHECK | 24h | dispara Notificação CONFIG_REVIEW quando promo FBA expirar |
| WHATSAPP_ESTOQUE_RESUMO | 5min | gate `isWhatsappEstoqueResumoSkip` (pula se `!ativo` ou hora local < `horario`); `dedupeKeyOverride` por data SP → 1 envio/dia mesmo após SUCESSO |

### SP-API & rate limit
LWA OAuth2 (refresh_token → access_token, header `x-amz-access-token`). Sem AWS SigV4. Defaults em `src/lib/amazon-rate-limit.ts`; `adoptObservedRateLimit()` calibra via `x-amzn-RateLimit-Limit`. Cooldown em `AmazonApiQuota.nextAllowedAt`. 429 → `markAmazonOperationRateLimited()` respeita `retry-after`; lança `AmazonQuotaCooldownError` (retry).
- **Helpers fail-fast**: `tryReserveAmazonOperationSlot(op)` reserva sem esperar (retorna bool); `getAmazonOperationCooldown(op)` inspeção read-only do cooldown.
- **Roles OK**: Inventory and Order Tracking, Finance and Accounting (inclui `getMyFeesEstimateForSKU` em Product Fees v0).
- **Roles 403**: Product Listing (Catalog Items full), Pricing (getMyFeesEstimates batch).
- **Quota agressiva observada**: PRODUCT_FEES_ESTIMATE retorna QuotaExceeded mesmo com 1 rps. Usar batch baixo + delay + fail-fast.

## Notificações (sino — sem email/Slack/Telegram)
Modelo `Notificacao` (dedupeKey @unique). Helpers `src/lib/notificacoes.ts`. Tipos: ESTOQUE_CRITICO · BUYBOX_PERDIDO/RECUPERADO · REEMBOLSO_ALTO · ACOS_ALTO · LIQUIDACAO_ATRASADA · CUSTO_AUSENTE · JOB_FALHANDO · QUOTA_BLOQUEADA · SETTLEMENT_NOVO · RECEBIMENTO_RECONCILIADO · WORKER_REINICIADO · REIMBURSEMENT_FBA_RECEBIDO · CONFIG_REVIEW.

**UI**: o sino vive no **topbar** (`src/components/topbar/notification-bell.tsx`) entre busca e perfil — popover com últimas 10 não-lidas + link "Ver todas" → `/notificacoes`. Saiu da sidebar (era um item do grupo Configuração). Página `/notificacoes` permanece intacta.

## Criptografia
`src/lib/crypto.ts` AES-256-GCM. Master em `CONFIG_ENCRYPTION_KEY` (32 bytes hex). `saveAmazonConfig()` cripta chaves matching `secret|token|password|senha|_key|_apikey`. Legado em texto puro ainda lido.

## Next.js 16 — params assíncrono (CRÍTICO)
```ts
type Params = { params: Promise<{ id: string }> };
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params; // NUNCA params.id direto
}
```

## UI compartilhado (`src/components/`)
- **`brand-mark.tsx`** — branding Atlas Seller (símbolo `public/atlas-symbol.png` + texto). Aceita `size: "sm" | "md"` e `collapsed` (esconde texto). Usado em sidebar (md) e topbar mobile (sm).
- **`ui/kpi-card.tsx`** — KPI básico (label/value/sub/icon, cores blue|green|red|orange|violet|slate). Para o dashboard e-commerce há custom inline com `borderColor` por categoria.
- **`ui/product-thumb.tsx`** — thumb 32/40/48/56px com fallback `ImageOff`. Usa `resolverImagemProduto()` de `src/lib/amazon-images.ts` (ordem: imagemUrl manual → amazonImagemUrl → imagemDoAsin).
- **`ui/margin-badge.tsx`** — pílula colorida automática: verde ≥25% · âmbar 10-24% · vermelho <10% · slate N/A.
- **`ui/trend-indicator.tsx`** — TrendingUp/Down (lucide) com polaridade invertível (custos = positivo é ruim).
- **`ui/filtro-periodo.tsx`** — chip + popover com 8 presets (Hoje, Ontem, 7d, 30d, Mês atual, Mês passado, Ano atual, Personalizado) reusando `src/lib/periodo.ts`. Compartilhado entre `/vendas` e (futuro) Dashboard E-commerce.
- **`vendas/marketplace-tag.tsx`** — pílula `amazon.com.br` com SVG inline do smile laranja. Aplica `normalizarNomeMarketplace`.
- Outros: `badge` · `card` · `dialog` · `popover` · `tooltip` · `table` · `skeleton` · `sonner` (toasts).

### Sidebar (`src/components/sidebar.tsx`)
- Todos os grupos iniciam fechados, **exceto** o grupo que contém a rota ativa (auto-expand).
- Preferência persistida em `localStorage["sidebar-groups-expanded"]` — uma vez que o usuário toggle, o auto-expand respeita o estado salvo.
- Item "Notificações" foi removido (sino migrou pro topbar — ver acima).

## Dashboard E-commerce (`/dashboard-ecommerce`)
Layout 8 KPIs primários + "Ver mais 8" secundários (toggle). Bordas laterais coloridas por categoria: **receita=verde** (Faturamento, Líq.Marketplace) · **operação=azul** (Lucro, Margem, Vendas, Unidades, Ticket, ROI) · **ads=âmbar** · **tráfego=violeta**. Chart "Resumo de receitas" = 3 áreas empilhadas (Faturamento violeta + Líq.Marketplace azul + Lucro emerald). Top 15 com `ProductThumb` 40px + `MarginBadge`. Filtro de período no header (inline). Service `obterTopProdutos` expõe `imagemUrl/amazonImagemUrl/asin`; `obterTimeline` inclui `liquidoMarketplaceCentavos`.
- **MPA pós contas fixas** (card compacto, ícone Σ `Sigma`, categoria ads): indicador complementar de planejamento = `(lucroPosAds − contasFixasDoPeríodo) / faturamento`. NÃO altera o MPA atual. Helper puro `calcularMpaPosContasFixas` em `contas-fixas/recorrencia.ts`; `obterKpis` soma as contas fixas ativas do período via `contasFixasService.totalDoPeriodo` (cálculo por definição, **sem escrever** no banco).

## Preferências do usuário
Sem redesign radical — incrementais. Protótipo HTML antes de mudanças visuais grandes (ver `mockups/`). Botões/modais > blocos fixos. Fluxo sem duplicidade. Alertas APENAS no sino.

## Deploy — VPS Hostinger
- Host SSH: alias `erp-vps` → `srv1611537.hstgr.cloud:2222`, user `mundofs`, key `~/.ssh/id_ed25519_mundofs_vps`.
- Path app: `/opt/erp-amazon` (owner `erp`). Stack: Postgres 16 self-hosted + Nginx (443→3000) + PM2 + cron + Let's Encrypt. Domínio `erp.mundofs.cloud`.
- **N8N rodando em paralelo**: container Docker em `127.0.0.1:5678`. Codex/n8n-observer modifica `src/lib/amazon-sp-api.ts`, `amazon-ads-api.ts`, `amazon-sqs.ts` direto na VPS — **sempre stashar tracked files ANTES do pull** (passar paths explícitos no stash). Pasta `backups/` criada como root pode bloquear stash full — usar `git stash push -- <arquivos>` específicos.
- **WAHA (WhatsApp do resumo de estoque)**: container Docker `waha` em **`127.0.0.1:3002`** (a porta 3001 do exemplo do doc está ocupada pelo `viability-app`), engine `WEBJS`, volume `/opt/waha/sessions`, `--restart unless-stopped`. Docker exige `sudo` (usuário `mundofs` fora do grupo docker). A `WAHA_API_KEY` do container = config `whatsapp_estoque_waha_api_key` no ERP. Sessão `default` pareada por código (`POST /api/{session}/auth/request-code`) ou QR. Operação detalhada em `deploy/waha-whatsapp-estoque.md` (atenção: o doc cita 3001; a instância real subiu em 3002).
- **Sequência de deploy** (rodar como `mundofs`, com `sudo -u erp`):
  ```bash
  cd /opt/erp-amazon && \
  git stash push -m "pre-deploy-$(date +%s)" -- src/lib/amazon-sp-api.ts src/lib/amazon-ads-api.ts src/lib/amazon-sqs.ts package-lock.json && \
  git pull --ff-only origin main && \
  npm install --no-audit --no-fund && \
  npm run prisma:migrate:deploy:pg && \
  npm run prisma:generate:pg && \
  rm -rf .next && npm run build && \
  pm2 reload erp-web --update-env && \
  pm2 reload erp-worker --update-env && \
  pm2 reload erp-sqs-consumer --update-env
  ```
- **`prisma:generate:pg` é OBRIGATÓRIO** quando há mudanças de schema. Sem isso, o client fica defasado e `db.<novoModel>.findUnique` retorna undefined em runtime (quebra dashboard com "Cannot read properties of undefined").
- `pm2 reload erp-web erp-worker erp-sqs-consumer` em UMA linha às vezes só reloada erp-web — usar 3 chamadas separadas pra garantir.
- Após build: atualizar `GIT_SHA` em `.env` (`git rev-parse --short HEAD`) e fazer `pm2 reload erp-web --update-env` (refletir em `/api/health`).
- Rollback: `git reset --hard <sha-anterior> && npm run prisma:generate:pg && npm run build && pm2 reload <todos>`.

## Cuidados especiais (gotchas)
- **OneDrive corrompe `.git`** — nunca abrir o repo em pasta sincronizada (`mmap failed: Invalid argument` em fetch). Use `c:\Projects\` ou similar.
- **Schema duplo**: prod usa `prisma:migrate:deploy:pg` (com `--schema prisma/schema.postgresql.prisma`). NÃO usar `prisma:migrate:deploy` sem `:pg` em prod (vai apontar pro schema SQLite).
- **SQS opcional**: liga com `AMAZON_SQS_QUEUE_URL` + `AWS_ACCESS_KEY_ID/SECRET`. Mapeia `ORDER_CHANGE→ORDERS_SYNC`, `ANY_OFFER_CHANGED→BUYBOX_CHECK`, `FBA_INVENTORY_*→INVENTORY_SYNC`, `REPORT_PROCESSING_FINISHED→SETTLEMENT_REPORT_SYNC`.
- **Migration manual Postgres**: usuário `erp_amazon` não tem permissão de shadow DB. NÃO usar `prisma migrate dev --schema=prisma/schema.postgresql.prisma`. Criar migration.sql manualmente em `prisma/migrations/<YYYYMMDDhhmmss>_<nome>/migration.sql` e aplicar com `prisma:migrate:deploy:pg`.
- **DB local SQLite frequentemente vazio** (size 0). Trabalho real acontece via VPS Postgres (queries `psql` SSH).
- **Confiabilidade financeira**: NUNCA escrever estimativa em `VendaAmazon.taxasCentavos`/`fretesCentavos`/`liquidoMarketplaceCentavos`. Esses campos são sagrados para DRE/Contas a Receber. Estimativas vivem em memória + `AmazonFeeEstimate` (cache, lookup-only). DRE usa `whereVendaAmazonContabilizavelEstrito()` que exclui PENDENTE.
- **AmazonForAllFee** (no payload Finance) = parcelamento 1.5%. Já incluído no agregado `AmazonFees`. NÃO somar duas vezes.
- **PRODUCT_FEES_ESTIMATE quota** é mais agressiva que documentado — Amazon retorna QuotaExceeded mesmo com 1 rps. Sempre fail-fast (`tryReserveAmazonOperationSlot`) + batch baixo (5) + delay (3s).

## Validação — só no que mudou
- Lint: `npx eslint <arquivo>` · Typecheck: `npx tsc --noEmit` · Testes: `npx vitest run <arquivo>`
- `npm run build` somente quando solicitado ou antes de deploy. NUNCA `npm run test` cego.

## Processo ao alterar Prisma
1. Encerrar Next (verifica `.dev-server.pid`).
2. Dev SQLite: `npm run prisma:generate && npm run prisma:push`. Dev Postgres: `npm run prisma:migrate:pg -- --name <nome>`.
3. Reiniciar. Prod: `npm run prisma:migrate:deploy:pg`.
