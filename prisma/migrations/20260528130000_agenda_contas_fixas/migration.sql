-- CreateTable
CREATE TABLE "ContaFixa" (
    "id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "diaVencimento" INTEGER NOT NULL,
    "recorrente" BOOLEAN NOT NULL DEFAULT true,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "categoriaId" TEXT,
    "fornecedorId" TEXT,
    "observacoes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaFixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarefa" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "prazo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "visibilidade" TEXT NOT NULL DEFAULT 'EMPRESA',
    "responsavelId" TEXT,
    "concluidaEm" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ContaPagar" ADD COLUMN "contaFixaId" TEXT,
ADD COLUMN "competencia" TEXT;

-- CreateIndex
CREATE INDEX "ContaFixa_ativa_idx" ON "ContaFixa"("ativa");

-- CreateIndex
CREATE INDEX "ContaFixa_diaVencimento_idx" ON "ContaFixa"("diaVencimento");

-- CreateIndex
CREATE INDEX "Tarefa_status_idx" ON "Tarefa"("status");

-- CreateIndex
CREATE INDEX "Tarefa_prazo_idx" ON "Tarefa"("prazo");

-- CreateIndex
CREATE INDEX "Tarefa_visibilidade_idx" ON "Tarefa"("visibilidade");

-- CreateIndex
CREATE INDEX "Tarefa_responsavelId_idx" ON "Tarefa"("responsavelId");

-- CreateIndex
CREATE UNIQUE INDEX "ContaPagar_contaFixaId_competencia_key" ON "ContaPagar"("contaFixaId", "competencia");

-- CreateIndex
CREATE INDEX "ContaPagar_contaFixaId_idx" ON "ContaPagar"("contaFixaId");

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_contaFixaId_fkey" FOREIGN KEY ("contaFixaId") REFERENCES "ContaFixa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaFixa" ADD CONSTRAINT "ContaFixa_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaFixa" ADD CONSTRAINT "ContaFixa_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
