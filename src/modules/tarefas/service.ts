import { StatusTarefa, VisibilidadeTarefa } from "@/modules/shared/domain";
import {
  atualizarTarefaSchema,
  criarTarefaSchema,
  criarTarefaRecorrenteSchema,
  atualizarTarefaRecorrenteSchema,
} from "./schemas";
import { tarefasRepository } from "./repository";
import { podeEditarTarefa } from "./visibilidade";
import {
  planejarOcorrenciasTarefas,
  type TarefaRecorrenteParaPlanejar,
  type TipoRecorrenciaTarefa,
} from "./recorrencia";
import { inicioDoDiaSP } from "@/lib/date";
import { logger } from "@/lib/logger";

const log = logger.child({ modulo: "tarefas/service" });

// A materialização roda em GET (agenda). Limita a janela para impedir que um
// range manipulado materialize milhares de ocorrências (anti-DoS) — mesma
// trava das contas fixas.
const MAX_DIAS_GERACAO = 400;
const DIA_MS = 24 * 60 * 60 * 1000;

function limitarIntervalo(de: Date, ate: Date): { de: Date; ate: Date } {
  if (ate.getTime() < de.getTime()) return { de, ate: de };
  const maxAte = new Date(de.getTime() + MAX_DIAS_GERACAO * DIA_MS);
  return { de, ate: ate.getTime() > maxAte.getTime() ? maxAte : ate };
}

type MoldeRecorrente = NonNullable<
  Awaited<ReturnType<typeof tarefasRepository.buscarRecorrente>>
>;

function paraPlanejarTarefa(molde: MoldeRecorrente): TarefaRecorrenteParaPlanejar {
  return {
    id: molde.id,
    tipoRecorrencia: molde.tipoRecorrencia as TipoRecorrenciaTarefa,
    diasSemana: molde.diasSemana
      ? (JSON.parse(molde.diasSemana) as number[])
      : null,
    diaMes: molde.diaMes,
    intervalo: molde.intervalo,
    unidadeIntervalo:
      (molde.unidadeIntervalo as "DIAS" | "SEMANAS" | null) ?? null,
    tipoTermino: molde.tipoTermino as TarefaRecorrenteParaPlanejar["tipoTermino"],
    terminoAte: molde.terminoAte,
    terminoMaxVezes: molde.terminoMaxVezes,
    inicioEm: molde.inicioEm,
  };
}

/** Converte prazo (yyyy-MM-dd) em Date ao meio-dia UTC (mesmo dia em SP). */
function prazoParaDate(prazo?: string | null): Date | null {
  if (!prazo) return null;
  return new Date(`${prazo}T12:00:00.000Z`);
}

function dataIsoNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
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

  // ---- Tarefas recorrentes ----

  listarRecorrentes(usuarioId: string) {
    return tarefasRepository.listarRecorrentesVisiveis(usuarioId);
  },

  async criarRecorrente(input: unknown, usuarioId: string) {
    const data = criarTarefaRecorrenteSchema.parse(input);
    const responsavelId =
      data.visibilidade === VisibilidadeTarefa.PESSOAL
        ? usuarioId
        : (data.responsavelId ?? usuarioId);
    return tarefasRepository.criarRecorrente({
      titulo: data.titulo,
      descricao: data.descricao ?? null,
      visibilidade: data.visibilidade,
      responsavelId,
      tipoRecorrencia: data.tipoRecorrencia,
      diasSemana: data.diasSemana ? JSON.stringify(data.diasSemana) : null,
      diaMes: data.diaMes ?? null,
      intervalo: data.intervalo,
      unidadeIntervalo: data.unidadeIntervalo ?? null,
      tipoTermino: data.tipoTermino,
      terminoAte: data.terminoAte ? dataIsoNoon(data.terminoAte) : null,
      terminoMaxVezes: data.terminoMaxVezes ?? null,
      inicioEm: dataIsoNoon(data.inicioEm),
      ativa: true,
    });
  },

  async atualizarRecorrente(id: string, input: unknown, usuarioId: string) {
    const data = atualizarTarefaRecorrenteSchema.parse(input);
    const atual = await tarefasRepository.buscarRecorrente(id);
    // anti-IDOR: PESSOAL só do dono. 404 genérico em qualquer outro caso.
    if (
      !atual ||
      (atual.visibilidade === VisibilidadeTarefa.PESSOAL &&
        atual.responsavelId !== usuarioId)
    ) {
      throw new Error("recorrência não encontrada");
    }

    const novaVisibilidade = data.visibilidade ?? atual.visibilidade;
    let responsavelId = atual.responsavelId;
    if (data.responsavelId !== undefined) responsavelId = data.responsavelId ?? null;
    if (novaVisibilidade === VisibilidadeTarefa.PESSOAL) responsavelId = usuarioId;

    const atualizado = await tarefasRepository.atualizarRecorrente(id, {
      ...(data.titulo != null ? { titulo: data.titulo } : {}),
      ...(data.descricao !== undefined ? { descricao: data.descricao ?? null } : {}),
      ...(data.visibilidade != null ? { visibilidade: data.visibilidade } : {}),
      responsavelId,
      ...(data.tipoRecorrencia != null
        ? { tipoRecorrencia: data.tipoRecorrencia }
        : {}),
      ...(data.diasSemana !== undefined
        ? { diasSemana: data.diasSemana ? JSON.stringify(data.diasSemana) : null }
        : {}),
      ...(data.diaMes !== undefined ? { diaMes: data.diaMes ?? null } : {}),
      ...(data.intervalo != null ? { intervalo: data.intervalo } : {}),
      ...(data.unidadeIntervalo !== undefined
        ? { unidadeIntervalo: data.unidadeIntervalo ?? null }
        : {}),
      ...(data.tipoTermino != null ? { tipoTermino: data.tipoTermino } : {}),
      ...(data.terminoAte !== undefined
        ? { terminoAte: data.terminoAte ? dataIsoNoon(data.terminoAte) : null }
        : {}),
      ...(data.terminoMaxVezes !== undefined
        ? { terminoMaxVezes: data.terminoMaxVezes ?? null }
        : {}),
      ...(data.inicioEm != null ? { inicioEm: dataIsoNoon(data.inicioEm) } : {}),
      ...(data.ativa != null ? { ativa: data.ativa } : {}),
    });

    if (data.aplicarFuturas) {
      await this.sincronizarOcorrenciasFuturasTarefas(id);
    }
    return atualizado;
  },

  async desativarRecorrente(id: string, usuarioId: string) {
    const atual = await tarefasRepository.buscarRecorrente(id);
    if (
      !atual ||
      (atual.visibilidade === VisibilidadeTarefa.PESSOAL &&
        atual.responsavelId !== usuarioId)
    ) {
      throw new Error("recorrência não encontrada");
    }
    await tarefasRepository.softDeleteRecorrente(id);
    // Remove ocorrências FUTURAS em aberto (nunca toca em concluídas/passadas).
    await this.sincronizarOcorrenciasFuturasTarefas(id);
    return { ok: true };
  },

  /**
   * Materializa, de forma IDEMPOTENTE, as ocorrências (Tarefa) das recorrências
   * ativas dentro de [de, ate]. Confia no set de chaves existentes + no índice
   * único (tarefaRecorrenteId, chaveOcorrencia) como rede final.
   */
  async garantirOcorrenciasTarefas(intervalo: { de: Date; ate: Date }) {
    const { de, ate } = limitarIntervalo(intervalo.de, intervalo.ate);
    const moldes =
      await tarefasRepository.listarRecorrentesAtivasParaMaterializar();
    if (moldes.length === 0) return { criadas: 0 };

    const existentes = await tarefasRepository.ocorrenciasMaterializadas(
      moldes.map((m) => m.id),
    );
    const setPorMolde = new Map<string, Set<string>>();
    for (const e of existentes) {
      if (!e.tarefaRecorrenteId || !e.chaveOcorrencia) continue;
      const set = setPorMolde.get(e.tarefaRecorrenteId) ?? new Set<string>();
      set.add(e.chaveOcorrencia);
      setPorMolde.set(e.tarefaRecorrenteId, set);
    }

    let criadas = 0;
    for (const molde of moldes) {
      const planejadas = planejarOcorrenciasTarefas(
        paraPlanejarTarefa(molde),
        de,
        ate,
        setPorMolde.get(molde.id) ?? new Set<string>(),
      );
      for (const occ of planejadas) {
        try {
          await tarefasRepository.criarOcorrencia({
            tarefaRecorrenteId: molde.id,
            chaveOcorrencia: occ.chaveOcorrencia,
            titulo: molde.titulo,
            descricao: molde.descricao,
            prazo: occ.dataPlanejada,
            visibilidade: molde.visibilidade,
            responsavelId: molde.responsavelId,
          });
          criadas += 1;
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === "P2002") continue; // corrida concorrente — ignora
          log.warn(
            { err, tarefaRecorrenteId: molde.id, chave: occ.chaveOcorrencia },
            "falha ao materializar ocorrência de tarefa recorrente",
          );
        }
      }
    }
    return { criadas };
  },

  /**
   * Reconcilia ocorrências FUTURAS em aberto com a definição atual do molde:
   * dia ainda planejado → atualiza metadados; dia fora do plano (molde inativo
   * ou recorrência alterada) → soft-delete. Nunca toca em concluídas/passadas.
   */
  async sincronizarOcorrenciasFuturasTarefas(id: string) {
    const molde = await tarefasRepository.buscarRecorrente(id);
    const corte = inicioDoDiaSP(new Date());
    const janelaAte = new Date(corte.getTime() + MAX_DIAS_GERACAO * DIA_MS);
    const ativa = !!molde && molde.ativa && !molde.deletedAt;
    const planejadas =
      molde && ativa
        ? planejarOcorrenciasTarefas(paraPlanejarTarefa(molde), corte, janelaAte)
        : [];
    const setPlanejadas = new Set(planejadas.map((o) => o.chaveOcorrencia));

    const futuras = await tarefasRepository.listarOcorrenciasFuturasEmAberto(
      id,
      corte,
    );
    let atualizadas = 0;
    let removidas = 0;
    for (const occ of futuras) {
      if (molde && occ.chaveOcorrencia && setPlanejadas.has(occ.chaveOcorrencia)) {
        await tarefasRepository.atualizarOcorrencia(occ.id, {
          titulo: molde.titulo,
          descricao: molde.descricao,
          visibilidade: molde.visibilidade,
          responsavelId: molde.responsavelId,
        });
        atualizadas += 1;
      } else {
        await tarefasRepository.removerOcorrencia(occ.id);
        removidas += 1;
      }
    }
    return { atualizadas, removidas };
  },
};
