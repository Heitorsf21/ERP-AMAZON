-- DropIndex
DROP INDEX "Categoria_nome_key";

-- DropIndex
DROP INDEX "Fornecedor_nome_key";

-- DropIndex
DROP INDEX "DocumentoFinanceiro_sha256_key";

-- DropIndex
DROP INDEX "Produto_sku_key";

-- DropIndex
DROP INDEX "Notificacao_dedupeKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_empresaId_nome_key" ON "Categoria"("empresaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_empresaId_nome_key" ON "Fornecedor"("empresaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoFinanceiro_empresaId_sha256_key" ON "DocumentoFinanceiro"("empresaId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_empresaId_sku_key" ON "Produto"("empresaId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Notificacao_empresaId_dedupeKey_key" ON "Notificacao"("empresaId", "dedupeKey");

