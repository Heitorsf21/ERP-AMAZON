-- CreateTable
CREATE TABLE "TarefaRecorrente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "visibilidade" TEXT NOT NULL DEFAULT 'EMPRESA',
    "responsavelId" TEXT,
    "tipoRecorrencia" TEXT NOT NULL DEFAULT 'SEMANAL',
    "diasSemana" TEXT,
    "diaMes" INTEGER,
    "intervalo" INTEGER NOT NULL DEFAULT 1,
    "unidadeIntervalo" TEXT,
    "tipoTermino" TEXT NOT NULL DEFAULT 'NUNCA',
    "terminoAte" TIMESTAMP(3),
    "terminoMaxVezes" INTEGER,
    "inicioEm" TIMESTAMP(3) NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarefaRecorrente_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Tarefa" ADD COLUMN "tarefaRecorrenteId" TEXT,
ADD COLUMN "chaveOcorrencia" TEXT;

-- CreateIndex
CREATE INDEX "TarefaRecorrente_ativa_idx" ON "TarefaRecorrente"("ativa");

-- CreateIndex
CREATE INDEX "TarefaRecorrente_responsavelId_idx" ON "TarefaRecorrente"("responsavelId");

-- CreateIndex
CREATE INDEX "Tarefa_tarefaRecorrenteId_idx" ON "Tarefa"("tarefaRecorrenteId");

-- CreateIndex
CREATE UNIQUE INDEX "Tarefa_tarefaRecorrenteId_chaveOcorrencia_key" ON "Tarefa"("tarefaRecorrenteId", "chaveOcorrencia");

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_tarefaRecorrenteId_fkey" FOREIGN KEY ("tarefaRecorrenteId") REFERENCES "TarefaRecorrente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
