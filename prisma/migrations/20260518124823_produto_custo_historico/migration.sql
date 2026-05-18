-- CreateTable
CREATE TABLE "ProdutoCustoHistorico" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "custoCentavos" INTEGER NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "origem" TEXT NOT NULL,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProdutoCustoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProdutoCustoHistorico_produtoId_vigenciaInicio_idx" ON "ProdutoCustoHistorico"("produtoId", "vigenciaInicio");

-- CreateIndex
CREATE INDEX "ProdutoCustoHistorico_vigenciaInicio_idx" ON "ProdutoCustoHistorico"("vigenciaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoCustoHistorico_produtoId_vigenciaInicio_key" ON "ProdutoCustoHistorico"("produtoId", "vigenciaInicio");

-- AddForeignKey
ALTER TABLE "ProdutoCustoHistorico" ADD CONSTRAINT "ProdutoCustoHistorico_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
