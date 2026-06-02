import { formatarDiaPeriodo } from "@/lib/periodo";
import {
  StatusConta,
  StatusTarefa,
  TipoItemAgenda,
} from "@/modules/shared/domain";
import { contasFixasRepository } from "@/modules/contas-fixas/repository";
import { contasFixasService } from "@/modules/contas-fixas/service";
import { tarefasService } from "@/modules/tarefas/service";

// Status normalizado para a Agenda (unifica tarefas e ocorrências de contas).
export const StatusAgenda = {
  ABERTA: "ABERTA",
  VENCIDA: "VENCIDA",
  CONCLUIDA: "CONCLUIDA",
  CANCELADA: "CANCELADA",
} as const;
export type StatusAgenda = (typeof StatusAgenda)[keyof typeof StatusAgenda];

// Tipos de filtro de origem aceitos pela Agenda.
export const FiltroOrigemAgenda = {
  TAREFA_EMPRESA: "TAREFA_EMPRESA",
  TAREFA_PESSOAL: "TAREFA_PESSOAL",
  TAREFA_MINHAS: "TAREFA_MINHAS",
  CONTA_FIXA: "CONTA_FIXA",
} as const;
export type FiltroOrigemAgenda =
  (typeof FiltroOrigemAgenda)[keyof typeof FiltroOrigemAgenda];

export type AgendaItem = {
  tipo: string; // TipoItemAgenda
  id: string;
  titulo: string;
  descricao: string | null;
  data: string | null; // ISO (UTC) do prazo/vencimento — null = sem prazo
  dia: string | null; // yyyy-MM-dd (SP) para agrupar no calendário
  status: string; // status cru da entidade
  statusAgenda: StatusAgenda;
  vencida: boolean;
  visibilidade: string | null;
  responsavel: { id: string; nome: string } | null;
  valorCentavos: number | null;
  contaFixaId: string | null;
  competencia: string | null;
  fornecedor: { id: string; nome: string } | null;
  categoria: { id: string; nome: string } | null;
};

type TarefaAgenda = Awaited<
  ReturnType<typeof tarefasService.listarParaAgenda>
>[number];
type OcorrenciaAgenda = Awaited<
  ReturnType<typeof contasFixasRepository.listarOcorrenciasNoPeriodo>
>[number];

function normalizarTarefa(t: TarefaAgenda, agora: Date): AgendaItem {
  const vencida =
    t.status === StatusTarefa.ABERTA &&
    t.prazo != null &&
    t.prazo.getTime() < agora.getTime();
  const statusAgenda: StatusAgenda =
    t.status === StatusTarefa.CONCLUIDA
      ? StatusAgenda.CONCLUIDA
      : t.status === StatusTarefa.CANCELADA
        ? StatusAgenda.CANCELADA
        : vencida
          ? StatusAgenda.VENCIDA
          : StatusAgenda.ABERTA;

  return {
    tipo: TipoItemAgenda.TAREFA,
    id: t.id,
    titulo: t.titulo,
    descricao: t.descricao,
    data: t.prazo ? t.prazo.toISOString() : null,
    dia: t.prazo ? formatarDiaPeriodo(t.prazo) : null,
    status: t.status,
    statusAgenda,
    vencida,
    visibilidade: t.visibilidade,
    responsavel: t.responsavel,
    valorCentavos: null,
    contaFixaId: null,
    competencia: null,
    fornecedor: null,
    categoria: null,
  };
}

function normalizarOcorrencia(o: OcorrenciaAgenda, agora: Date): AgendaItem {
  const vencida =
    o.status === StatusConta.VENCIDA ||
    (o.status === StatusConta.ABERTA && o.vencimento.getTime() < agora.getTime());
  const statusAgenda: StatusAgenda =
    o.status === StatusConta.PAGA
      ? StatusAgenda.CONCLUIDA
      : vencida
        ? StatusAgenda.VENCIDA
        : StatusAgenda.ABERTA;

  return {
    tipo: TipoItemAgenda.CONTA_FIXA,
    id: o.id,
    titulo: o.descricao,
    descricao: o.observacoes ?? null,
    data: o.vencimento.toISOString(),
    dia: formatarDiaPeriodo(o.vencimento),
    status: o.status,
    statusAgenda,
    vencida,
    visibilidade: null,
    responsavel: null,
    valorCentavos: o.valor,
    contaFixaId: o.contaFixaId,
    competencia: o.competencia,
    fornecedor: o.fornecedor,
    categoria: o.categoria,
  };
}

function casaTipo(
  item: AgendaItem,
  tipos: string[],
  usuarioId: string,
): boolean {
  if (tipos.length === 0) return true;
  if (item.tipo === TipoItemAgenda.CONTA_FIXA) {
    return tipos.includes(FiltroOrigemAgenda.CONTA_FIXA);
  }
  const alvos: string[] = [];
  if (item.visibilidade === "EMPRESA") alvos.push(FiltroOrigemAgenda.TAREFA_EMPRESA);
  if (item.visibilidade === "PESSOAL") alvos.push(FiltroOrigemAgenda.TAREFA_PESSOAL);
  if (item.responsavel?.id === usuarioId) alvos.push(FiltroOrigemAgenda.TAREFA_MINHAS);
  return alvos.some((a) => tipos.includes(a));
}

export const agendaService = {
  async listarPorPeriodo(params: {
    usuarioId: string;
    de: Date;
    ate: Date;
    tipos?: string[];
    status?: string[];
  }): Promise<{ itens: AgendaItem[] }> {
    const { usuarioId, de, ate } = params;
    const tipos = params.tipos ?? [];
    const status = params.status ?? [];

    // Materializa ocorrências de contas fixas e de tarefas recorrentes no
    // período (idempotente). Tarefas viram registros Tarefa normais e entram
    // na agregação abaixo sem tratamento especial.
    await Promise.all([
      contasFixasService.garantirOcorrencias({ de, ate }),
      tarefasService.garantirOcorrenciasTarefas({ de, ate }),
    ]);

    const [tarefas, ocorrencias] = await Promise.all([
      tarefasService.listarParaAgenda(usuarioId, de, ate),
      contasFixasRepository.listarOcorrenciasNoPeriodo(de, ate),
    ]);

    const agora = new Date();
    const itens: AgendaItem[] = [
      ...tarefas.map((t) => normalizarTarefa(t, agora)),
      ...ocorrencias.map((o) => normalizarOcorrencia(o, agora)),
    ]
      .filter((item) => casaTipo(item, tipos, usuarioId))
      .filter((item) => status.length === 0 || status.includes(item.statusAgenda));

    // Ordena: itens com data (por dia), depois backlog sem prazo.
    itens.sort((a, b) => {
      if (a.dia && b.dia) return a.dia.localeCompare(b.dia) || a.titulo.localeCompare(b.titulo);
      if (a.dia) return -1;
      if (b.dia) return 1;
      return a.titulo.localeCompare(b.titulo);
    });

    return { itens };
  },
};
