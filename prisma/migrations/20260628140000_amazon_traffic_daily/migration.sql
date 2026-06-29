-- Metricas de Sales & Traffic no NIVEL CONTA, com quebra DIARIA.
-- Fonte: secao `salesAndTrafficByDate` do GET_SALES_AND_TRAFFIC_REPORT (1 linha
-- por dia, com campo `date`). E a fonte CORRETA e somavel para os KPIs de
-- trafego do dashboard.
--
-- Por que separada de AmazonSkuTrafficDaily: a tabela por SKU vem da secao
-- `salesAndTrafficByAsin`, que AGREGA o periodo inteiro do report por SKU (sem
-- dimensao de data). Tratada como "diaria" e somada, inflava os KPIs ~11x.

CREATE TABLE "AmazonTrafficDaily" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "data" TIMESTAMP(3) NOT NULL,
    "sessoes" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "unitsOrdered" INTEGER NOT NULL DEFAULT 0,
    "orderedRevenueCentavos" INTEGER NOT NULL DEFAULT 0,
    "buyBoxPercent" DOUBLE PRECISION,
    "conversaoPercent" DOUBLE PRECISION,
    "currency" TEXT,
    "payloadJson" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonTrafficDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AmazonTrafficDaily_data_key" ON "AmazonTrafficDaily"("data");
