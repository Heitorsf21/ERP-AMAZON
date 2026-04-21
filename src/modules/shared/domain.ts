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
  INVENTORY: "INVENTORY",
  REVIEWS: "REVIEWS",
  TEST: "TEST",
  ALL: "ALL",
} as const;
export type TipoAmazonSync =
  (typeof TipoAmazonSync)[keyof typeof TipoAmazonSync];

export const StatusAmazonReviewSolicitation = {
  PENDENTE: "PENDENTE",
  ELEGIVEL: "ELEGIVEL",
  ENVIADO: "ENVIADO",
  NAO_ELEGIVEL: "NAO_ELEGIVEL",
  ERRO: "ERRO",
} as const;
export type StatusAmazonReviewSolicitation =
  (typeof StatusAmazonReviewSolicitation)[keyof typeof StatusAmazonReviewSolicitation];

// Derivado em runtime, nunca persistido no banco
export const StatusReposicao = {
  OK: "OK",
  ATENCAO: "ATENCAO",
  REPOR: "REPOR",
} as const;
export type StatusReposicao =
  (typeof StatusReposicao)[keyof typeof StatusReposicao];
