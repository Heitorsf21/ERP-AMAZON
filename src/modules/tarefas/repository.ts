import { db } from "@/lib/db";
import { StatusTarefa } from "@/modules/shared/domain";
import { orVisibilidadeTarefa } from "./visibilidade";

const incluirResponsavel = {
  responsavel: { select: { id: true, nome: true } },
} as const;

export const tarefasRepository = {
  /**
   * Tarefas visíveis ao usuário cujo prazo cai em [de, ate], MAIS o backlog
   * sem prazo que ainda está ABERTA.
   */
  listarParaAgenda(usuarioId: string, de: Date, ate: Date) {
    return db.tarefa.findMany({
      where: {
        deletedAt: null,
        AND: [
          { OR: orVisibilidadeTarefa(usuarioId) },
          {
            OR: [
              { prazo: { gte: de, lte: ate } },
              { prazo: null, status: StatusTarefa.ABERTA },
            ],
          },
        ],
      },
      orderBy: [{ prazo: "asc" }, { createdAt: "asc" }],
      include: incluirResponsavel,
    });
  },

  /** Busca por id apenas dentro do escopo visível ao usuário (anti-IDOR). */
  buscarVisivel(id: string, usuarioId: string) {
    return db.tarefa.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: orVisibilidadeTarefa(usuarioId),
      },
      include: incluirResponsavel,
    });
  },

  criar(data: {
    titulo: string;
    descricao?: string | null;
    prazo?: Date | null;
    status: string;
    visibilidade: string;
    responsavelId?: string | null;
  }) {
    return db.tarefa.create({ data, include: incluirResponsavel });
  },

  atualizar(
    id: string,
    data: Partial<{
      titulo: string;
      descricao: string | null;
      prazo: Date | null;
      status: string;
      visibilidade: string;
      responsavelId: string | null;
      concluidaEm: Date | null;
    }>,
  ) {
    return db.tarefa.update({
      where: { id },
      data,
      include: incluirResponsavel,
    });
  },

  softDelete(id: string) {
    return db.tarefa.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },

  // ---- Tarefas recorrentes (moldes) ----

  listarRecorrentesAtivasParaMaterializar() {
    return db.tarefaRecorrente.findMany({
      where: { ativa: true, deletedAt: null },
    });
  },

  listarRecorrentesVisiveis(usuarioId: string) {
    return db.tarefaRecorrente.findMany({
      where: {
        deletedAt: null,
        OR: [
          { visibilidade: "EMPRESA" },
          { visibilidade: "PESSOAL", responsavelId: usuarioId },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  },

  buscarRecorrente(id: string) {
    return db.tarefaRecorrente.findFirst({ where: { id, deletedAt: null } });
  },

  criarRecorrente(data: {
    titulo: string;
    descricao: string | null;
    visibilidade: string;
    responsavelId: string | null;
    tipoRecorrencia: string;
    diasSemana: string | null;
    diaMes: number | null;
    intervalo: number;
    unidadeIntervalo: string | null;
    tipoTermino: string;
    terminoAte: Date | null;
    terminoMaxVezes: number | null;
    inicioEm: Date;
    ativa: boolean;
  }) {
    return db.tarefaRecorrente.create({ data });
  },

  atualizarRecorrente(
    id: string,
    data: Partial<{
      titulo: string;
      descricao: string | null;
      visibilidade: string;
      responsavelId: string | null;
      tipoRecorrencia: string;
      diasSemana: string | null;
      diaMes: number | null;
      intervalo: number;
      unidadeIntervalo: string | null;
      tipoTermino: string;
      terminoAte: Date | null;
      terminoMaxVezes: number | null;
      inicioEm: Date;
      ativa: boolean;
    }>,
  ) {
    return db.tarefaRecorrente.update({ where: { id }, data });
  },

  softDeleteRecorrente(id: string) {
    return db.tarefaRecorrente.update({
      where: { id },
      data: { ativa: false, deletedAt: new Date() },
    });
  },

  // ---- Materialização idempotente de ocorrências ----

  ocorrenciasMaterializadas(recorrenteIds: string[]) {
    return db.tarefa.findMany({
      where: { tarefaRecorrenteId: { in: recorrenteIds }, deletedAt: null },
      select: { tarefaRecorrenteId: true, chaveOcorrencia: true },
    });
  },

  criarOcorrencia(data: {
    tarefaRecorrenteId: string;
    chaveOcorrencia: string;
    titulo: string;
    descricao: string | null;
    prazo: Date;
    visibilidade: string;
    responsavelId: string | null;
  }) {
    return db.tarefa.create({
      data: {
        titulo: data.titulo,
        descricao: data.descricao,
        prazo: data.prazo,
        status: StatusTarefa.ABERTA,
        visibilidade: data.visibilidade,
        responsavelId: data.responsavelId,
        tarefaRecorrenteId: data.tarefaRecorrenteId,
        chaveOcorrencia: data.chaveOcorrencia,
      },
    });
  },

  listarOcorrenciasFuturasEmAberto(recorrenteId: string, corte: Date) {
    return db.tarefa.findMany({
      where: {
        tarefaRecorrenteId: recorrenteId,
        deletedAt: null,
        status: StatusTarefa.ABERTA,
        prazo: { gte: corte },
      },
      select: { id: true, chaveOcorrencia: true },
    });
  },

  atualizarOcorrencia(
    id: string,
    data: Partial<{
      titulo: string;
      descricao: string | null;
      visibilidade: string;
      responsavelId: string | null;
    }>,
  ) {
    return db.tarefa.update({ where: { id }, data });
  },

  removerOcorrencia(id: string) {
    return db.tarefa.update({
      where: { id },
      data: { deletedAt: new Date(), chaveOcorrencia: null },
    });
  },
};
