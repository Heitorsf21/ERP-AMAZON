-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "ultimoAcesso" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "contato" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movimentacao" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "dataCompetencia" TIMESTAMP(3) NOT NULL,
    "dataCaixa" TIMESTAMP(3) NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "referenciaId" TEXT,
    "motivoAjuste" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaPagar" (
    "id" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "recorrencia" TEXT NOT NULL DEFAULT 'NENHUMA',
    "contaPaiId" TEXT,
    "pagoEm" TIMESTAMP(3),
    "movimentacaoId" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nfAnexo" TEXT,
    "nfNome" TEXT,

    CONSTRAINT "ContaPagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DossieFinanceiro" (
    "id" TEXT NOT NULL,
    "fornecedorNome" TEXT,
    "fornecedorDocumento" TEXT,
    "descricao" TEXT,
    "valor" INTEGER,
    "vencimento" TIMESTAMP(3),
    "numeroDocumento" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "contaPagarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DossieFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoFinanceiro" (
    "id" TEXT NOT NULL,
    "dossieId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "caminhoArquivo" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "textoExtraido" TEXT,
    "fornecedorNome" TEXT,
    "fornecedorDocumento" TEXT,
    "descricao" TEXT,
    "valor" INTEGER,
    "vencimento" TIMESTAMP(3),
    "numeroDocumento" TEXT,
    "chaveAcesso" TEXT,
    "linhaDigitavel" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "protegidoPorSenha" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentoFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaReceber" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "dataPrevisao" TIMESTAMP(3),
    "dataRecebimento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "origem" TEXT NOT NULL DEFAULT 'AMAZON',
    "liquidacaoId" TEXT,
    "totalPedidos" INTEGER NOT NULL DEFAULT 0,
    "movimentacaoId" TEXT,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaReceber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "custoUnitario" INTEGER,
    "precoVenda" INTEGER,
    "amazonEstoqueDisponivel" INTEGER,
    "amazonEstoqueReservado" INTEGER,
    "amazonEstoqueInbound" INTEGER,
    "amazonEstoqueTotal" INTEGER,
    "amazonUltimaSyncEm" TIMESTAMP(3),
    "estoqueAtual" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "solicitarReviewsAtivo" BOOLEAN NOT NULL DEFAULT true,
    "imagemUrl" TEXT,
    "observacoes" TEXT,
    "amazonImagemUrl" TEXT,
    "amazonTituloOficial" TEXT,
    "amazonCategoria" TEXT,
    "amazonCatalogSyncEm" TIMESTAMP(3),
    "buyboxGanho" BOOLEAN,
    "buyboxPreco" INTEGER,
    "buyboxConcorrentes" INTEGER,
    "buyboxUltimaSyncEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaAmazon" (
    "id" TEXT NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "titulo" TEXT,
    "quantidade" INTEGER NOT NULL,
    "precoUnitarioCentavos" INTEGER NOT NULL,
    "valorBrutoCentavos" INTEGER,
    "taxasCentavos" INTEGER NOT NULL DEFAULT 0,
    "fretesCentavos" INTEGER NOT NULL DEFAULT 0,
    "liquidoMarketplaceCentavos" INTEGER,
    "custoUnitarioCentavos" INTEGER,
    "liquidacaoId" TEXT,
    "marketplace" TEXT,
    "fulfillmentChannel" TEXT,
    "statusPedido" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "statusFinanceiro" TEXT NOT NULL DEFAULT 'PENDENTE',
    "dataVenda" TIMESTAMP(3) NOT NULL,
    "ultimaSyncEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendaAmazon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonReembolso" (
    "id" TEXT NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "titulo" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "valorReembolsadoCentavos" INTEGER NOT NULL,
    "taxasReembolsadasCentavos" INTEGER NOT NULL DEFAULT 0,
    "dataReembolso" TIMESTAMP(3) NOT NULL,
    "liquidacaoId" TEXT,
    "marketplace" TEXT,
    "referenciaExterna" TEXT NOT NULL,
    "statusFinanceiro" TEXT,
    "motivoCategoria" TEXT,
    "produtoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonReembolso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsGastoManual" (
    "id" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFim" TIMESTAMP(3) NOT NULL,
    "produtoId" TEXT,
    "valorCentavos" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdsGastoManual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentacaoEstoque" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "custoUnitario" INTEGER,
    "origem" TEXT NOT NULL,
    "referenciaId" TEXT,
    "observacoes" TEXT,
    "dataMovimentacao" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimentacaoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoCompra" (
    "id" TEXT NOT NULL,
    "numero" TEXT,
    "fornecedorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "dataEmissao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataPrevisao" TIMESTAMP(3),
    "dataRecebimento" TIMESTAMP(3),
    "totalCentavos" INTEGER NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "contaPagarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPedidoCompra" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "custoUnitario" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPedidoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncLog" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mensagem" TEXT,
    "detalhes" JSONB,
    "registros" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmazonSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSyncJob" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonApiQuota" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "nextAllowedAt" TIMESTAMP(3),
    "rateLimitPerSecond" DOUBLE PRECISION,
    "burst" INTEGER,
    "observedRps" DOUBLE PRECISION,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonApiQuota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonReviewSolicitation" (
    "id" TEXT NOT NULL,
    "amazonOrderId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "origem" TEXT NOT NULL DEFAULT 'DAILY',
    "asin" TEXT,
    "sku" TEXT,
    "orderCreatedAt" TIMESTAMP(3),
    "eligibleFrom" TIMESTAMP(3),
    "deliveryWindowStart" TIMESTAMP(3),
    "deliveryWindowEnd" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "qualificationReason" TEXT,
    "resolvedReason" TEXT,
    "lastCheckedAction" TEXT,
    "checkedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonReviewSolicitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoSistema" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoSistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoteImportacaoFBA" (
    "id" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "totalLinhas" INTEGER NOT NULL,
    "periodoInicio" TIMESTAMP(3),
    "periodoFim" TIMESTAMP(3),
    "produtosAtualizados" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteImportacaoFBA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaFBA" (
    "id" TEXT NOT NULL,
    "numeroPedido" TEXT NOT NULL,
    "marketplace" TEXT,
    "status" TEXT NOT NULL,
    "dataCompra" TIMESTAMP(3) NOT NULL,
    "asin" TEXT,
    "skuExterno" TEXT NOT NULL,
    "skuInterno" TEXT,
    "titulo" TEXT,
    "quantidade" INTEGER NOT NULL,
    "precoUnitarioCentavos" INTEGER NOT NULL,
    "totalCentavos" INTEGER NOT NULL,
    "loteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendaFBA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoteMetricaGS" (
    "id" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoteMetricaGS_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoMetricaGestorSeller" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "produtoId" TEXT,
    "sku" TEXT NOT NULL,
    "titulo" TEXT,
    "custoUnitarioCentavos" INTEGER,
    "precoVendaCentavos" INTEGER,
    "unidadesVendidasTotais" INTEGER NOT NULL DEFAULT 0,
    "vendasAmazonCentavos" INTEGER NOT NULL DEFAULT 0,
    "vendasMlCentavos" INTEGER NOT NULL DEFAULT 0,
    "vendasShopeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "vendasTikTokCentavos" INTEGER NOT NULL DEFAULT 0,
    "faturamentoCentavos" INTEGER NOT NULL DEFAULT 0,
    "lucroCentavos" INTEGER NOT NULL DEFAULT 0,
    "margemPercentual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "custoAdsCentavos" INTEGER NOT NULL DEFAULT 0,
    "lucroPosAdsCentavos" INTEGER NOT NULL DEFAULT 0,
    "mpaPercentual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProdutoMetricaGestorSeller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportacaoLote" (
    "id" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "totalLinhas" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportacaoLote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdsCampanha" (
    "id" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFim" TIMESTAMP(3) NOT NULL,
    "nomeCampanha" TEXT NOT NULL,
    "asin" TEXT,
    "sku" TEXT,
    "impressoes" INTEGER NOT NULL DEFAULT 0,
    "cliques" INTEGER NOT NULL DEFAULT 0,
    "gastoCentavos" INTEGER NOT NULL,
    "vendasAtribuidasCentavos" INTEGER NOT NULL DEFAULT 0,
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "unidades" INTEGER NOT NULL DEFAULT 0,
    "acosPercentual" DOUBLE PRECISION,
    "roas" DOUBLE PRECISION,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdsCampanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notificacao" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "linkRef" TEXT,
    "dedupeKey" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmazonSettlementReport" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reportDocumentId" TEXT,
    "settlementId" TEXT,
    "periodoInicio" TIMESTAMP(3),
    "periodoFim" TIMESTAMP(3),
    "depositDate" TIMESTAMP(3),
    "totalAmountCentavos" INTEGER,
    "processadoEm" TIMESTAMP(3),
    "contasGeradas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSettlementReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyBoxSnapshot" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT,
    "sku" TEXT NOT NULL,
    "asin" TEXT,
    "somosBuybox" BOOLEAN NOT NULL,
    "precoNosso" INTEGER,
    "precoBuybox" INTEGER,
    "sellerBuybox" TEXT,
    "numeroOfertas" INTEGER,
    "capturadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyBoxSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_email_idx" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "Usuario_ativo_idx" ON "Usuario"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_nome_key" ON "Categoria"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_nome_key" ON "Fornecedor"("nome");

-- CreateIndex
CREATE INDEX "Movimentacao_dataCaixa_idx" ON "Movimentacao"("dataCaixa");

-- CreateIndex
CREATE INDEX "Movimentacao_tipo_idx" ON "Movimentacao"("tipo");

-- CreateIndex
CREATE INDEX "Movimentacao_categoriaId_idx" ON "Movimentacao"("categoriaId");

-- CreateIndex
CREATE INDEX "Movimentacao_origem_idx" ON "Movimentacao"("origem");

-- CreateIndex
CREATE UNIQUE INDEX "ContaPagar_movimentacaoId_key" ON "ContaPagar"("movimentacaoId");

-- CreateIndex
CREATE INDEX "ContaPagar_status_idx" ON "ContaPagar"("status");

-- CreateIndex
CREATE INDEX "ContaPagar_vencimento_idx" ON "ContaPagar"("vencimento");

-- CreateIndex
CREATE INDEX "ContaPagar_fornecedorId_idx" ON "ContaPagar"("fornecedorId");

-- CreateIndex
CREATE UNIQUE INDEX "DossieFinanceiro_contaPagarId_key" ON "DossieFinanceiro"("contaPagarId");

-- CreateIndex
CREATE INDEX "DossieFinanceiro_status_idx" ON "DossieFinanceiro"("status");

-- CreateIndex
CREATE INDEX "DossieFinanceiro_fornecedorDocumento_idx" ON "DossieFinanceiro"("fornecedorDocumento");

-- CreateIndex
CREATE INDEX "DossieFinanceiro_vencimento_idx" ON "DossieFinanceiro"("vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoFinanceiro_sha256_key" ON "DocumentoFinanceiro"("sha256");

-- CreateIndex
CREATE INDEX "DocumentoFinanceiro_dossieId_idx" ON "DocumentoFinanceiro"("dossieId");

-- CreateIndex
CREATE INDEX "DocumentoFinanceiro_tipo_idx" ON "DocumentoFinanceiro"("tipo");

-- CreateIndex
CREATE INDEX "DocumentoFinanceiro_fornecedorDocumento_idx" ON "DocumentoFinanceiro"("fornecedorDocumento");

-- CreateIndex
CREATE INDEX "DocumentoFinanceiro_vencimento_idx" ON "DocumentoFinanceiro"("vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "ContaReceber_movimentacaoId_key" ON "ContaReceber"("movimentacaoId");

-- CreateIndex
CREATE INDEX "ContaReceber_status_idx" ON "ContaReceber"("status");

-- CreateIndex
CREATE INDEX "ContaReceber_dataPrevisao_idx" ON "ContaReceber"("dataPrevisao");

-- CreateIndex
CREATE INDEX "ContaReceber_liquidacaoId_idx" ON "ContaReceber"("liquidacaoId");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_sku_key" ON "Produto"("sku");

-- CreateIndex
CREATE INDEX "Produto_sku_idx" ON "Produto"("sku");

-- CreateIndex
CREATE INDEX "Produto_asin_idx" ON "Produto"("asin");

-- CreateIndex
CREATE INDEX "Produto_ativo_idx" ON "Produto"("ativo");

-- CreateIndex
CREATE INDEX "Produto_amazonUltimaSyncEm_idx" ON "Produto"("amazonUltimaSyncEm");

-- CreateIndex
CREATE INDEX "Produto_estoqueAtual_idx" ON "Produto"("estoqueAtual");

-- CreateIndex
CREATE INDEX "VendaAmazon_orderItemId_idx" ON "VendaAmazon"("orderItemId");

-- CreateIndex
CREATE INDEX "VendaAmazon_dataVenda_idx" ON "VendaAmazon"("dataVenda");

-- CreateIndex
CREATE INDEX "VendaAmazon_sku_idx" ON "VendaAmazon"("sku");

-- CreateIndex
CREATE INDEX "VendaAmazon_liquidacaoId_idx" ON "VendaAmazon"("liquidacaoId");

-- CreateIndex
CREATE INDEX "VendaAmazon_statusPedido_idx" ON "VendaAmazon"("statusPedido");

-- CreateIndex
CREATE INDEX "VendaAmazon_statusFinanceiro_idx" ON "VendaAmazon"("statusFinanceiro");

-- CreateIndex
CREATE INDEX "VendaAmazon_ultimaSyncEm_idx" ON "VendaAmazon"("ultimaSyncEm");

-- CreateIndex
CREATE UNIQUE INDEX "VendaAmazon_amazonOrderId_sku_key" ON "VendaAmazon"("amazonOrderId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonReembolso_referenciaExterna_key" ON "AmazonReembolso"("referenciaExterna");

-- CreateIndex
CREATE INDEX "AmazonReembolso_amazonOrderId_idx" ON "AmazonReembolso"("amazonOrderId");

-- CreateIndex
CREATE INDEX "AmazonReembolso_orderItemId_idx" ON "AmazonReembolso"("orderItemId");

-- CreateIndex
CREATE INDEX "AmazonReembolso_sku_idx" ON "AmazonReembolso"("sku");

-- CreateIndex
CREATE INDEX "AmazonReembolso_dataReembolso_idx" ON "AmazonReembolso"("dataReembolso");

-- CreateIndex
CREATE INDEX "AmazonReembolso_liquidacaoId_idx" ON "AmazonReembolso"("liquidacaoId");

-- CreateIndex
CREATE INDEX "AmazonReembolso_produtoId_idx" ON "AmazonReembolso"("produtoId");

-- CreateIndex
CREATE INDEX "AmazonReembolso_motivoCategoria_idx" ON "AmazonReembolso"("motivoCategoria");

-- CreateIndex
CREATE INDEX "AdsGastoManual_periodoInicio_periodoFim_idx" ON "AdsGastoManual"("periodoInicio", "periodoFim");

-- CreateIndex
CREATE INDEX "AdsGastoManual_produtoId_idx" ON "AdsGastoManual"("produtoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_produtoId_idx" ON "MovimentacaoEstoque"("produtoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_dataMovimentacao_idx" ON "MovimentacaoEstoque"("dataMovimentacao");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_tipo_idx" ON "MovimentacaoEstoque"("tipo");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_origem_idx" ON "MovimentacaoEstoque"("origem");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoCompra_contaPagarId_key" ON "PedidoCompra"("contaPagarId");

-- CreateIndex
CREATE INDEX "PedidoCompra_status_idx" ON "PedidoCompra"("status");

-- CreateIndex
CREATE INDEX "PedidoCompra_dataEmissao_idx" ON "PedidoCompra"("dataEmissao");

-- CreateIndex
CREATE INDEX "PedidoCompra_fornecedorId_idx" ON "PedidoCompra"("fornecedorId");

-- CreateIndex
CREATE INDEX "ItemPedidoCompra_pedidoId_idx" ON "ItemPedidoCompra"("pedidoId");

-- CreateIndex
CREATE INDEX "ItemPedidoCompra_produtoId_idx" ON "ItemPedidoCompra"("produtoId");

-- CreateIndex
CREATE INDEX "AmazonSyncLog_createdAt_idx" ON "AmazonSyncLog"("createdAt");

-- CreateIndex
CREATE INDEX "AmazonSyncLog_tipo_idx" ON "AmazonSyncLog"("tipo");

-- CreateIndex
CREATE INDEX "AmazonSyncLog_status_idx" ON "AmazonSyncLog"("status");

-- CreateIndex
CREATE INDEX "AmazonSyncJob_status_runAfter_priority_idx" ON "AmazonSyncJob"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "AmazonSyncJob_tipo_idx" ON "AmazonSyncJob"("tipo");

-- CreateIndex
CREATE INDEX "AmazonSyncJob_dedupeKey_idx" ON "AmazonSyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AmazonSyncJob_createdAt_idx" ON "AmazonSyncJob"("createdAt");

-- CreateIndex
CREATE INDEX "AmazonSyncJob_lockedAt_idx" ON "AmazonSyncJob"("lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonApiQuota_operation_key" ON "AmazonApiQuota"("operation");

-- CreateIndex
CREATE INDEX "AmazonApiQuota_nextAllowedAt_idx" ON "AmazonApiQuota"("nextAllowedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonReviewSolicitation_amazonOrderId_key" ON "AmazonReviewSolicitation"("amazonOrderId");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_status_idx" ON "AmazonReviewSolicitation"("status");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_origem_idx" ON "AmazonReviewSolicitation"("origem");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_orderCreatedAt_idx" ON "AmazonReviewSolicitation"("orderCreatedAt");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_eligibleFrom_idx" ON "AmazonReviewSolicitation"("eligibleFrom");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_deliveryWindowEnd_idx" ON "AmazonReviewSolicitation"("deliveryWindowEnd");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_nextCheckAt_idx" ON "AmazonReviewSolicitation"("nextCheckAt");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_lastAttemptAt_idx" ON "AmazonReviewSolicitation"("lastAttemptAt");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_sentAt_idx" ON "AmazonReviewSolicitation"("sentAt");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_createdAt_idx" ON "AmazonReviewSolicitation"("createdAt");

-- CreateIndex
CREATE INDEX "AmazonReviewSolicitation_marketplaceId_idx" ON "AmazonReviewSolicitation"("marketplaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoSistema_chave_key" ON "ConfiguracaoSistema"("chave");

-- CreateIndex
CREATE INDEX "LoteImportacaoFBA_tipo_idx" ON "LoteImportacaoFBA"("tipo");

-- CreateIndex
CREATE INDEX "LoteImportacaoFBA_createdAt_idx" ON "LoteImportacaoFBA"("createdAt");

-- CreateIndex
CREATE INDEX "VendaFBA_skuExterno_idx" ON "VendaFBA"("skuExterno");

-- CreateIndex
CREATE INDEX "VendaFBA_dataCompra_idx" ON "VendaFBA"("dataCompra");

-- CreateIndex
CREATE INDEX "VendaFBA_status_idx" ON "VendaFBA"("status");

-- CreateIndex
CREATE INDEX "VendaFBA_loteId_idx" ON "VendaFBA"("loteId");

-- CreateIndex
CREATE UNIQUE INDEX "VendaFBA_numeroPedido_skuExterno_key" ON "VendaFBA"("numeroPedido", "skuExterno");

-- CreateIndex
CREATE INDEX "LoteMetricaGS_createdAt_idx" ON "LoteMetricaGS"("createdAt");

-- CreateIndex
CREATE INDEX "ProdutoMetricaGestorSeller_sku_idx" ON "ProdutoMetricaGestorSeller"("sku");

-- CreateIndex
CREATE INDEX "ProdutoMetricaGestorSeller_produtoId_idx" ON "ProdutoMetricaGestorSeller"("produtoId");

-- CreateIndex
CREATE INDEX "ProdutoMetricaGestorSeller_loteId_idx" ON "ProdutoMetricaGestorSeller"("loteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoMetricaGestorSeller_loteId_sku_key" ON "ProdutoMetricaGestorSeller"("loteId", "sku");

-- CreateIndex
CREATE INDEX "ImportacaoLote_criadoEm_idx" ON "ImportacaoLote"("criadoEm");

-- CreateIndex
CREATE INDEX "AdsCampanha_periodoInicio_periodoFim_idx" ON "AdsCampanha"("periodoInicio", "periodoFim");

-- CreateIndex
CREATE INDEX "AdsCampanha_sku_idx" ON "AdsCampanha"("sku");

-- CreateIndex
CREATE INDEX "AdsCampanha_nomeCampanha_idx" ON "AdsCampanha"("nomeCampanha");

-- CreateIndex
CREATE UNIQUE INDEX "Notificacao_dedupeKey_key" ON "Notificacao"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notificacao_lida_idx" ON "Notificacao"("lida");

-- CreateIndex
CREATE INDEX "Notificacao_tipo_idx" ON "Notificacao"("tipo");

-- CreateIndex
CREATE INDEX "Notificacao_criadaEm_idx" ON "Notificacao"("criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSettlementReport_reportId_key" ON "AmazonSettlementReport"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "AmazonSettlementReport_settlementId_key" ON "AmazonSettlementReport"("settlementId");

-- CreateIndex
CREATE INDEX "AmazonSettlementReport_settlementId_idx" ON "AmazonSettlementReport"("settlementId");

-- CreateIndex
CREATE INDEX "AmazonSettlementReport_depositDate_idx" ON "AmazonSettlementReport"("depositDate");

-- CreateIndex
CREATE INDEX "AmazonSettlementReport_processadoEm_idx" ON "AmazonSettlementReport"("processadoEm");

-- CreateIndex
CREATE INDEX "BuyBoxSnapshot_sku_capturadoEm_idx" ON "BuyBoxSnapshot"("sku", "capturadoEm");

-- CreateIndex
CREATE INDEX "BuyBoxSnapshot_produtoId_idx" ON "BuyBoxSnapshot"("produtoId");

-- CreateIndex
CREATE INDEX "BuyBoxSnapshot_capturadoEm_idx" ON "BuyBoxSnapshot"("capturadoEm");

-- AddForeignKey
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_contaPaiId_fkey" FOREIGN KEY ("contaPaiId") REFERENCES "ContaPagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_movimentacaoId_fkey" FOREIGN KEY ("movimentacaoId") REFERENCES "Movimentacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossieFinanceiro" ADD CONSTRAINT "DossieFinanceiro_contaPagarId_fkey" FOREIGN KEY ("contaPagarId") REFERENCES "ContaPagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoFinanceiro" ADD CONSTRAINT "DocumentoFinanceiro_dossieId_fkey" FOREIGN KEY ("dossieId") REFERENCES "DossieFinanceiro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaReceber" ADD CONSTRAINT "ContaReceber_movimentacaoId_fkey" FOREIGN KEY ("movimentacaoId") REFERENCES "Movimentacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmazonReembolso" ADD CONSTRAINT "AmazonReembolso_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdsGastoManual" ADD CONSTRAINT "AdsGastoManual_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoCompra" ADD CONSTRAINT "PedidoCompra_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoCompra" ADD CONSTRAINT "PedidoCompra_contaPagarId_fkey" FOREIGN KEY ("contaPagarId") REFERENCES "ContaPagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedidoCompra" ADD CONSTRAINT "ItemPedidoCompra_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedidoCompra" ADD CONSTRAINT "ItemPedidoCompra_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaFBA" ADD CONSTRAINT "VendaFBA_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteImportacaoFBA"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoMetricaGestorSeller" ADD CONSTRAINT "ProdutoMetricaGestorSeller_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "LoteMetricaGS"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoMetricaGestorSeller" ADD CONSTRAINT "ProdutoMetricaGestorSeller_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyBoxSnapshot" ADD CONSTRAINT "BuyBoxSnapshot_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

