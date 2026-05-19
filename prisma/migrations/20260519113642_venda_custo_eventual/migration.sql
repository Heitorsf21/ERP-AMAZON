-- CreateTable
CREATE TABLE "VendaCustoEventual" (
    "id" TEXT NOT NULL,
    "vendaAmazonId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,

    CONSTRAINT "VendaCustoEventual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendaCustoEventual_vendaAmazonId_idx" ON "VendaCustoEventual"("vendaAmazonId");

-- AddForeignKey
ALTER TABLE "VendaCustoEventual" ADD CONSTRAINT "VendaCustoEventual_vendaAmazonId_fkey" FOREIGN KEY ("vendaAmazonId") REFERENCES "VendaAmazon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
