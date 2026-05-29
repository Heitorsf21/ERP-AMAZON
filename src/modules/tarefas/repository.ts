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
};
