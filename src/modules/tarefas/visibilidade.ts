// Regras PURAS de visibilidade de tarefas (testáveis sem DB).
//
// Segurança: tarefas PESSOAL são privadas do dono — nem outros usuários nem
// ADMIN devem visualizá-las (privacidade, conforme requisito). Tarefas EMPRESA
// são visíveis a qualquer usuário autenticado. Estas regras são aplicadas no
// SERVIDOR (não só na UI) para evitar IDOR.
import { VisibilidadeTarefa } from "@/modules/shared/domain";

export type TarefaVisibilidade = {
  visibilidade: string;
  responsavelId: string | null;
};

/** Verdadeiro se `usuarioId` pode visualizar a tarefa. */
export function podeVerTarefa(
  tarefa: TarefaVisibilidade,
  usuarioId: string,
): boolean {
  if (tarefa.visibilidade === VisibilidadeTarefa.PESSOAL) {
    return tarefa.responsavelId === usuarioId;
  }
  return tarefa.visibilidade === VisibilidadeTarefa.EMPRESA;
}

/**
 * Verdadeiro se `usuarioId` pode editar/concluir/excluir a tarefa.
 * Hoje a regra coincide com a de visualização: PESSOAL só o dono; EMPRESA
 * qualquer usuário autenticado. Mantido separado para evoluir RBAC depois.
 */
export function podeEditarTarefa(
  tarefa: TarefaVisibilidade,
  usuarioId: string,
): boolean {
  return podeVerTarefa(tarefa, usuarioId);
}

/** Cláusula `OR` do Prisma que restringe às tarefas visíveis ao usuário. */
export function orVisibilidadeTarefa(usuarioId: string) {
  return [
    { visibilidade: VisibilidadeTarefa.EMPRESA },
    { visibilidade: VisibilidadeTarefa.PESSOAL, responsavelId: usuarioId },
  ];
}
