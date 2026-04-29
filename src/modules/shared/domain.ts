// Constantes de domínio compartilhadas (SQLite não tem enum nativo, então
// centralizamos aqui as strings válidas para cada campo "tipo-enum").

export const TipoCategoria = {
  RECEITA: "RECEITA",
  DESPESA: "DESPESA",
  AMBAS: "AMBAS",
} as const;
export type TipoCategoria = (typeof TipoCategoria)[keyof typeof TipoCategoria];

export const TipoMovimentacao = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAIDA",
} as const;
export type TipoMovimentacao = (typeof TipoMovimentacao)[keyof typeof TipoMovimentacao];

export const OrigemMovimentacao = {
  MANUAL: "MANUAL",
  CONTA_PAGA: "CONTA_PAGA",
  IMPORTACAO: "IMPORTACAO",
  AJUSTE: "AJUSTE",
} as const;
export type OrigemMovimentacao =
  (typeof OrigemMovimentacao)[keyof typeof OrigemMovimentacao];

export const StatusConta = {
  ABERTA: "ABERTA",
  VENCIDA: "VENCIDA",
  PAGA: "PAGA",
  CANCELADA: "CANCELADA",
} as const;
export type StatusConta = (typeof StatusConta)[keyof typeof StatusConta];

export const RecorrenciaConta = {
  NENHUMA: "NENHUMA",
  MENSAL: "MENSAL",
} as const;
export type RecorrenciaConta =
  (typeof RecorrenciaConta)[keyof typeof RecorrenciaConta];

export const FormatoImportacao = {
  GENERICO: "GENERICO",
  NUBANK: "NUBANK",
} as const;
export type FormatoImportacao =
  (typeof FormatoImportacao)[keyof typeof FormatoImportacao];

export const TipoDocumentoFinanceiro = {
  BOLETO: "BOLETO",
  NOTA_FISCAL: "NOTA_FISCAL",
  OUTRO: "OUTRO",
} as const;
export type TipoDocumentoFinanceiro =
  (typeof TipoDocumentoFinanceiro)[keyof typeof TipoDocumentoFinanceiro];

export const StatusDossieFinanceiro = {
  PENDENTE: "PENDENTE",
  VINCULADO_CONTA: "VINCULADO_CONTA",
} as const;
export type StatusDossieFinanceiro =
  (typeof StatusDossieFinanceiro)[keyof typeof StatusDossieFinanceiro];

// ── Contas a Receber ────────────────────────────────────────────────

export const StatusContaReceber = {
  PENDENTE: "PENDENTE",
  RECEBIDA: "RECEBIDA",
  CANCELADA: "CANCELADA",
} as const;
export type StatusContaReceber =
  (typeof StatusContaReceber)[keyof typeof StatusContaReceber];

export const OrigemContaReceber = {
  AMAZON: "AMAZON",
  MANUAL: "MANUAL",
} as const;
export type OrigemContaReceber =
  (typeof OrigemContaReceber)[keyof typeof OrigemContaReceber];

// Roles de usuário. O campo segue como String no Prisma para manter
// compatibilidade SQLite/Postgres sem enum nativo.
export const UsuarioRole = {
  ADMIN: "ADMIN",
  OPERADOR: "OPERADOR",
  FINANCEIRO: "FINANCEIRO",
  LEITURA: "LEITURA",
} as const;
export type UsuarioRole = (typeof UsuarioRole)[keyof typeof UsuarioRole];

// Tipo de transação dentro do relatório Amazon
export const TipoTransacaoAmazon = {
  PEDIDO: "Pedido",
  TRANSFERIR: "Transferir",
  REEMBOLSO: "Reembolso",
  AJUSTE: "Ajuste",
  TAXA_ESTOQUE_FBA: "Taxa de Estoque FBA",
  TAXA_SERVICO: "Taxa de serviço",
  OUTROS: "Outros",
} as const;
export type TipoTransacaoAmazon =
  (typeof TipoTransacaoAmazon)[keyof typeof TipoTransacaoAmazon];

export const StatusTransacaoAmazon = {
  LIBERADO: "Liberado",
  DIFERIDO: "Diferido",
} as const;
export type StatusTransacaoAmazon =
  (typeof StatusTransacaoAmazon)[keyof typeof StatusTransacaoAmazon];

// ── Estoque ────────────────────────────────────────────────────────────────

export const TipoMovimentacaoEstoque = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAIDA",
} as const;
export type TipoMovimentacaoEstoque =
  (typeof TipoMovimentacaoEstoque)[keyof typeof TipoMovimentacaoEstoque];

export const OrigemMovimentacaoEstoque = {
  MANUAL: "MANUAL",
  IMPORTACAO: "IMPORTACAO",
  AJUSTE: "AJUSTE",
  COMPRA: "COMPRA",
  VENDA: "VENDA",
} as const;
export type OrigemMovimentacaoEstoque =
  (typeof OrigemMovimentacaoEstoque)[keyof typeof OrigemMovimentacaoEstoque];

// ── Compras ─────────────────────────────────────────────────────────────────

export const StatusPedidoCompra = {
  RASCUNHO: "RASCUNHO",
  CONFIRMADO: "CONFIRMADO",
  RECEBIDO: "RECEBIDO",
  CANCELADO: "CANCELADO",
} as const;
export type StatusPedidoCompra =
  (typeof StatusPedidoCompra)[keyof typeof StatusPedidoCompra];

// ── Amazon Sync ──────────────────────────────────────────────────────────────

export const StatusAmazonSync = {
  PROCESSANDO: "PROCESSANDO",
  SUCESSO: "SUCESSO",
  ERRO: "ERRO",
} as const;
export type StatusAmazonSync =
  (typeof StatusAmazonSync)[keyof typeof StatusAmazonSync];

export const TipoAmazonSync = {
  ORDERS: "ORDERS",
  FINANCES: "FINANCES",
  REFUNDS: "REFUNDS",
  INVENTORY: "INVENTORY",
  BACKFILL: "BACKFILL",
  REVIEWS: "REVIEWS",
  TEST: "TEST",
  ALL: "ALL",
} as const;
export type TipoAmazonSync =
  (typeof TipoAmazonSync)[keyof typeof TipoAmazonSync];

export const TipoAmazonSyncJob = {
  ORDERS_SYNC: "ORDERS_SYNC",
  FINANCES_SYNC: "FINANCES_SYNC",
  INVENTORY_SYNC: "INVENTORY_SYNC",
  REFUNDS_SYNC: "REFUNDS_SYNC",
  REVIEWS_DISCOVERY: "REVIEWS_DISCOVERY",
  REVIEWS_SEND: "REVIEWS_SEND",
  REPORTS_BACKFILL: "REPORTS_BACKFILL",
  SETTLEMENT_REPORT_SYNC: "SETTLEMENT_REPORT_SYNC",
  BUYBOX_CHECK: "BUYBOX_CHECK",
  CATALOG_REFRESH: "CATALOG_REFRESH",
  // Sprint 2 — backfill que sustenta a DRE
  FINANCES_BACKFILL: "FINANCES_BACKFILL",
  SETTLEMENT_BACKFILL: "SETTLEMENT_BACKFILL",
  INVENTORY_SNAPSHOT: "INVENTORY_SNAPSHOT",
  // Sprint 3 — reports financeiros Amazon pendentes
  FBA_REIMBURSEMENTS_SYNC: "FBA_REIMBURSEMENTS_SYNC",
  RETURNS_SYNC: "RETURNS_SYNC",
  FBA_STORAGE_SYNC: "FBA_STORAGE_SYNC",
  TRAFFIC_SYNC: "TRAFFIC_SYNC",
} as const;
export type TipoAmazonSyncJob =
  (typeof TipoAmazonSyncJob)[keyof typeof TipoAmazonSyncJob];

export const StatusFbmPicking = {
  ABERTO: "ABERTO",
  EM_SEPARACAO: "EM_SEPARACAO",
  CONFERIDO: "CONFERIDO",
  DESPACHADO: "DESPACHADO",
  CANCELADO: "CANCELADO",
} as const;
export type StatusFbmPicking =
  (typeof StatusFbmPicking)[keyof typeof StatusFbmPicking];

export const StatusFbmPickingItem = {
  PENDENTE: "PENDENTE",
  SEPARADO: "SEPARADO",
  CONFERIDO: "CONFERIDO",
  DIVERGENTE: "DIVERGENTE",
} as const;
export type StatusFbmPickingItem =
  (typeof StatusFbmPickingItem)[keyof typeof StatusFbmPickingItem];

export const TipoAuditLog = {
  LOGIN_SUCESSO: "LOGIN_SUCESSO",
  LOGIN_FALHA: "LOGIN_FALHA",
  CONFIG_ATUALIZADA: "CONFIG_ATUALIZADA",
  AMAZON_SYNC_MANUAL: "AMAZON_SYNC_MANUAL",
  PRODUTO_CRIADO: "PRODUTO_CRIADO",
  PRODUTO_ATUALIZADO: "PRODUTO_ATUALIZADO",
  PRODUTO_DESATIVADO: "PRODUTO_DESATIVADO",
  LISTING_DIFF_CONSULTADO: "LISTING_DIFF_CONSULTADO",
  PRODUTO_VARIACAO_CRIADA: "PRODUTO_VARIACAO_CRIADA",
  PRODUTO_VARIACAO_REMOVIDA: "PRODUTO_VARIACAO_REMOVIDA",
  FBM_PICKING_CRIADO: "FBM_PICKING_CRIADO",
  FBM_PICKING_ATUALIZADO: "FBM_PICKING_ATUALIZADO",
} as const;
export type TipoAuditLog = (typeof TipoAuditLog)[keyof typeof TipoAuditLog];

export const StatusAmazonSyncJob = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type StatusAmazonSyncJob =
  (typeof StatusAmazonSyncJob)[keyof typeof StatusAmazonSyncJob];

export const StatusAmazonReviewSolicitation = {
  PENDENTE: "PENDENTE",
  AGUARDANDO: "AGUARDANDO",
  ELEGIVEL: "ELEGIVEL",
  ENVIADO: "ENVIADO",
  JA_SOLICITADO: "JA_SOLICITADO",
  NAO_ELEGIVEL: "NAO_ELEGIVEL",
  EXPIRADO: "EXPIRADO",
  ERRO: "ERRO",
} as const;
export type StatusAmazonReviewSolicitation =
  (typeof StatusAmazonReviewSolicitation)[keyof typeof StatusAmazonReviewSolicitation];

export const OrigemAmazonReviewSolicitation = {
  BACKFILL: "BACKFILL",
  DAILY: "DAILY",
  MANUAL: "MANUAL",
} as const;
export type OrigemAmazonReviewSolicitation =
  (typeof OrigemAmazonReviewSolicitation)[keyof typeof OrigemAmazonReviewSolicitation];

// Derivado em runtime, nunca persistido no banco
export const StatusReposicao = {
  OK: "OK",
  ATENCAO: "ATENCAO",
  REPOR: "REPOR",
} as const;
export type StatusReposicao =
  (typeof StatusReposicao)[keyof typeof StatusReposicao];

// ── Notificações operacionais ───────────────────────────────────────
export const TipoNotificacao = {
  ESTOQUE_CRITICO: "ESTOQUE_CRITICO",
  BUYBOX_PERDIDO: "BUYBOX_PERDIDO",
  BUYBOX_RECUPERADO: "BUYBOX_RECUPERADO",
  REEMBOLSO_ALTO: "REEMBOLSO_ALTO",
  ACOS_ALTO: "ACOS_ALTO",
  LIQUIDACAO_ATRASADA: "LIQUIDACAO_ATRASADA",
  CUSTO_AUSENTE: "CUSTO_AUSENTE",
  JOB_FALHANDO: "JOB_FALHANDO",
  QUOTA_BLOQUEADA: "QUOTA_BLOQUEADA",
  SETTLEMENT_NOVO: "SETTLEMENT_NOVO",
  RECEBIMENTO_RECONCILIADO: "RECEBIMENTO_RECONCILIADO",
  WORKER_REINICIADO: "WORKER_REINICIADO",
  REIMBURSEMENT_FBA_RECEBIDO: "REIMBURSEMENT_FBA_RECEBIDO",
} as const;
export type TipoNotificacao =
  (typeof TipoNotificacao)[keyof typeof TipoNotificacao];
