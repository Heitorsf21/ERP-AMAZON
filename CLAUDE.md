

# Contexto — ERP Amazon

## Stack
- Next.js App Router + TypeScript + Prisma + SQLite
- Dev: `http://localhost:3000` | PID salvo em `.dev-server.pid`
- Dinheiro sempre em centavos (`Int`). Fuso: `America/Sao_Paulo`.
- Nunca expor `.env` ou `OPENAI_API_KEY`.
- ESLint flat config em `eslint.config.mjs`. `next.config.mjs` usa `typedRoutes: true`.

## Versões-chave
next 16.2.4 · vitest 4.1.4 · eslint 9.39.4 · @libpdf/core (PDF protegido por senha)

## Schema Prisma — modelos ativos
DossieFinanceiro · DocumentoFinanceiro · ContaPagar · ContaReceber · Movimentacao · Fornecedor
Produto · MovimentacaoEstoque · PedidoCompra · ItemPedidoCompra · AmazonSyncLog · ConfiguracaoSistema · ImportacaoLote

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
- Status da transação: Liberado (já transferido) | Diferido (a receber).
- Diferidos → ContaReceber PENDENTE por liquidação (liquidacaoId).
- Reimportação: atualiza existentes por liquidacaoId.
- Qualquer linha "Transferir" na liquidação = TRANSFERIDO (nunca usar threshold %).
- Liquidação marcada como TRANSFERIDO no CSV mais recente → ContaReceber = RECEBIDA.
- Reimportação de CSV parcial: usa Math.max(existente, novo) para valor e totalPedidos.
- Ciclo médio de liquidação: ~14 dias (dataPrevisao = data última transação + 14 dias).
- Marcar recebida manualmente: POST /api/contas-a-receber/[id]/marcar-recebida.
- totais() retorna: totalPendenteCentavos, quantidadePendente, totalRecebidaCentavos, quantidadeRecebida, totalCentavos.
- Estado atual (17/04/2026): 13 RECEBIDA (R$9.657,22) · 6 PENDENTE (R$2.544,08) · Total R$12.201,30.

## Arquivos de referência (não apagar)
- MARTINS_9349830.pdf (senha: 10338212) — boleto protegido
- 8f0c1001-...pdf — NF da mesma compra
- NU_4699049964_01AGO2025_15ABR2026.csv/.ofx — extrato Nubank (ago/2025–abr/2026)
- NU_4699049964_01ABR2026_16ABR2026.csv — extrato Nubank abr/2026 (último lançamento Amazon: 13/04)
- 2026MarMonthlyUnifiedTransaction.csv — Amazon março/2026 (329 txns)
- 2026Apr1-2026Apr15CustomUnifiedTransaction.csv — Amazon abr 1-15/2026 (123 txns, original)
- 2026Apr1-2026Apr15CustomUnifiedTransaction (1).csv — Amazon abr 1-15/2026 (reimportação com Transferir de 06/04, 08/04, 13/04)

## Rotas principais
- /api/contas — GET (filtros: status, de, ate) · POST (criar)
- /api/contas/[id] — PATCH · DELETE
- /api/contas/[id]/pagar — POST { pagoEm: "YYYY-MM-DD" } → cria Movimentacao SAIDA + marca PAGA + gera próxima se MENSAL
- /api/contas/[id]/reverter — POST → desfaz pagamento (deleta Movimentacao, volta ABERTA/VENCIDA)
- /api/contas-a-receber — GET (?status=PENDENTE|RECEBIDA)
- /api/contas-a-receber/importar-amazon — POST multipart (arquivo CSV)
- /api/contas-a-receber/totais — GET
- /api/contas-a-receber/[id]/marcar-recebida — POST
- /api/documentos-financeiros · /api/fornecedores (force-dynamic)

### Estoque
- /api/estoque/produtos — GET (?ativo, ?busca) · POST
- /api/estoque/produtos/[id] — GET · PATCH · DELETE
- /api/estoque/produtos/[id]/movimentacoes — GET · POST
- /api/estoque/totais — GET (CardResumoEstoque, dashboard)
- /api/estoque/importar — POST (bulk upsert planilha)

### Compras (F5)
- /api/compras — GET (?status) · POST (criar rascunho)
- /api/compras/[id] — GET · PATCH · DELETE (cancelar)
- /api/compras/[id]/confirmar — POST → status CONFIRMADO + cria ContaPagar
- /api/compras/[id]/receber — POST → status RECEBIDO + MovimentacaoEstoque ENTRADA por item
- /api/compras/sugestoes — GET (produtos com statusReposicao REPOR/ATENCAO)
- /api/compras/totais — GET (CardResumoCompras, dashboard)

### Destinação de Caixa (F6)
- /api/destinacao/resumo — GET → { saldoAtual, comprometidoContas, comprometidoCompras, totalComprometido, aReceber, saldoLivre, saldoProjetado }

### Conector Amazon / SP-API (F7)
- /api/amazon/config — GET (credenciais mascaradas) · POST (salvar config)
- /api/amazon/sync — POST { tipo: ORDERS|INVENTORY|TEST, diasAtras? }
- /api/amazon/status — GET (histórico AmazonSyncLog)
- Credenciais salvas em ConfiguracaoSistema com chaves: amazon_client_id, amazon_client_secret, amazon_refresh_token, amazon_aws_access_key_id, amazon_aws_secret_access_key, amazon_marketplace_id, amazon_seller_id
- Autenticação: LWA OAuth2 (refresh_token → access_token) + AWS Signature V4 (implementado em src/lib/amazon-sp-api.ts)

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

## Preferências do usuário
- Sem redesign radical. Melhorias visuais incrementais.
- Preferir botões/modais a blocos fixos.
- Propor protótipo antes de mudanças visuais grandes.
- Fluxo de documentos deve evitar duplicidade.

## Processo ao alterar Prisma
1. Encerrar servidor Next se rodando (verifica PID antes).
2. `npm.cmd run prisma:generate && npm.cmd run prisma:push`
3. Reiniciar servidor.

## Validação — rodar SOMENTE no que foi alterado
Após cada alteração, testar apenas os arquivos/módulos modificados:
- Lint: `npx eslint `
- Typecheck: `npx tsc --noEmit` (se tocou tipos)
- Testes: `npx vitest run ` (somente o arquivo de teste relacionado)
- Build completo somente quando explicitamente solicitado ou antes de deploy.
Não rodar `npm run test` completo após cada comando — desnecessário e caro.
