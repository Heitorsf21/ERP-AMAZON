import { StatusTarefa, VisibilidadeTarefa } from "@/modules/shared/domain";
import { atualizarTarefaSchema, criarTarefaSchema } from "./schemas";
import { tarefasRepository } from "./repository";
import { podeEditarTarefa } from "./visibilidade";

/** Converte prazo (yyyy-MM-dd) em Date ao meio-dia UTC (mesmo dia em SP). */
function prazoParaDate(prazo?: string | null): Date | null {
  if (!prazo) return null;
  return new Date(`${prazo}T12:00:00.000Z`);
}

function patchStatus(
  status: string,
): { status: string; concluidaEm?: Date | null } {
  if (status === StatusTarefa.CONCLUIDA) {
    return { status, concluidaEm: new Date() };
  }
  if (status === StatusTarefa.ABERTA) {
    return { status, concluidaEm: null };
  }
  return { status };
}

export const tarefasService = {
  listarParaAgenda(usuarioId: string, de: Date, ate: Date) {
    return tarefasRepository.listarParaAgenda(usuarioId, de, ate);
  },

  /** 404 se a tarefa não existir OU não for visível ao usuário (anti-IDOR). */
  async buscarAutorizada(id: string, usuarioId: string) {
    const tarefa = await tarefasRepository.buscarVisivel(id, usuarioId);
    if (!tarefa) throw new Error("tarefa não encontrada");
    return tarefa;
  },

  async criar(input: unknown, usuarioId: string) {
    const data = criarTarefaSchema.parse(input);
    // PESSOAL: dono forçado ao criador (não dá para criar tarefa privada de
    // outra pessoa). EMPRESA: responsável informado ou o próprio criador.
    const responsavelId =
      data.visibilidade === VisibilidadeTarefa.PESSOAL
        ? usuarioId
        : (data.responsavelId ?? usuarioId);

    return tarefasRepository.criar({
      titulo: data.titulo,
      descricao: data.descricao ?? null,
      prazo: prazoParaDate(data.prazo),
      status: StatusTarefa.ABERTA,
      visibilidade: data.visibilidade,
      responsavelId,
    });
  },

  async atualizar(id: string, input: unknown, usuarioId: string) {
    const data = atualizarTarefaSchema.parse(input);
    const atual = await this.buscarAutorizada(id, usuarioId);
    if (!podeEditarTarefa(atual, usuarioId)) {
      throw new Error("tarefa não encontrada");
    }

    const novaVisibilidade = data.visibilidade ?? atual.visibilidade;
    let responsavelId = atual.responsavelId;
    if (data.responsavelId !== undefined) responsavelId = data.responsavelId ?? null;
    // Não permite "doar" uma tarefa privada: PESSOAL sempre pertence ao usuário.
    if (novaVisibilidade === VisibilidadeTarefa.PESSOAL) responsavelId = usuarioId;

    return tarefasRepository.atualizar(id, {
      ...(data.titulo != null ? { titulo: data.titulo } : {}),
      ...(data.descricao !== undefined
        ? { descricao: data.descricao ?? null }
        : {}),
      ...(data.prazo !== undefined ? { prazo: prazoParaDate(data.prazo) } : {}),
      ...(data.visibilidade != null ? { visibilidade: data.visibilidade } : {}),
      responsavelId,
      ...(data.status != null ? patchStatus(data.status) : {}),
    });
  },

  async concluir(id: string, usuarioId: string) {
    const atual = await this.buscarAutorizada(id, usuarioId);
    if (!podeEditarTarefa(atual, usuarioId)) {
      throw new Error("tarefa não encontrada");
    }
    return tarefasRepository.atualizar(id, {
      status: StatusTarefa.CONCLUIDA,
      concluidaEm: new Date(),
    });
  },

  async excluir(id: string, usuarioId: string) {
    const atual = await this.buscarAutorizada(id, usuarioId);
    if (!podeEditarTarefa(atual, usuarioId)) {
      throw new Error("tarefa não encontrada");
    }
    return tarefasRepository.softDelete(id);
  },
};
