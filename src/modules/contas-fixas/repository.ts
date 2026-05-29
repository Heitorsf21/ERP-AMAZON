import { db } from "@/lib/db";
import { StatusConta } from "@/modules/shared/domain";

const incluirRelacoes = {
  categoria: { select: { id: true, nome: true } },
  fornecedor: { select: { id: true, nome: true } },
} as const;

export const contasFixasRepository = {
  listar(incluirInativas = false) {
    return db.contaFixa.findMany({
      where: { deletedAt: null, ...(incluirInativas ? {} : { ativa: true }) },
      orderBy: [
        { ativa: "desc" },
        { diaVencimento: "asc" },
        { descricao: "asc" },
      ],
      include: incluirRelacoes,
    });
  },

  buscarPorId(id: string) {
    return db.contaFixa.findFirst({
      where: { id, deletedAt: null },
      include: incluirRelacoes,
    });
  },

  /**
   * Contas fixas ativas, com todos os campos necessários para planejar e
   * materializar ocorrências (e calcular o total do período).
   */
  listarAtivasParaMaterializar() {
    return db.contaFixa.findMany({
      where: { ativa: true, deletedAt: null },
      select: {
        id: true,
        descricao: true,
        valor: true,
        diaVencimento: true,
        recorrente: true,
        competenciaUnica: true,
        categoriaId: true,
        fornecedorId: true,
        observacoes: true,
        createdAt: true,
      },
    });
  },

  /** Busca crua (ignora deletedAt) — usada na sincronização de ocorrências. */
  buscarRaw(id: string) {
    return db.contaFixa.findUnique({
      where: { id },
      select: {
        id: true,
        descricao: true,
        valor: true,
        diaVencimento: true,
        recorrente: true,
        competenciaUnica: true,
        ativa: true,
        deletedAt: true,
        createdAt: true,
      },
    });
  },

  criar(data: {
    descricao: string;
    valor: number;
    diaVencimento: number;
    recorrente: boolean;
    competenciaUnica?: string | null;
    ativa: boolean;
    categoriaId?: string | null;
    fornecedorId?: string | null;
    observacoes?: string | null;
  }) {
    return db.contaFixa.create({ data, include: incluirRelacoes });
  },

  atualizar(
    id: string,
    data: Partial<{
      descricao: string;
      valor: number;
      diaVencimento: number;
      recorrente: boolean;
      competenciaUnica: string | null;
      ativa: boolean;
      categoriaId: string | null;
      fornecedorId: string | null;
      observacoes: string | null;
    }>,
  ) {
    return db.contaFixa.update({
      where: { id },
      data,
      include: incluirRelacoes,
    });
  },

  /** Ocorrências futuras (vencimento >= corte) ainda em aberto (não pagas). */
  listarOcorrenciasFuturasEmAberto(contaFixaId: string, corte: Date) {
    return db.contaPagar.findMany({
      where: {
        contaFixaId,
        deletedAt: null,
        competencia: { not: null },
        status: { in: [StatusConta.ABERTA, StatusConta.VENCIDA] },
        vencimento: { gte: corte },
      },
      select: { id: true, competencia: true, valor: true, vencimento: true },
    });
  },

  atualizarOcorrencia(
    id: string,
    data: { valor: number; vencimento: Date; descricao: string },
  ) {
    return db.contaPagar.update({ where: { id }, data });
  },

  /**
   * Soft-delete de uma ocorrência futura que deixou de ser planejada.
   * Zera `competencia` para liberar o índice único (regeneração futura) e
   * preservar a auditoria (linha permanece com deletedAt).
   */
  removerOcorrencia(id: string) {
    return db.contaPagar.update({
      where: { id },
      data: { deletedAt: new Date(), competencia: null },
    });
  },

  /** Soft-delete: marca deletedAt e desativa (preserva ocorrências já geradas). */
  softDelete(id: string) {
    return db.contaFixa.update({
      where: { id },
      data: { deletedAt: new Date(), ativa: false },
    });
  },

  /** Ocorrências já materializadas (ContaPagar) das contas fixas informadas. */
  ocorrenciasMaterializadas(contaFixaIds: string[]) {
    if (contaFixaIds.length === 0) {
      return Promise.resolve(
        [] as Array<{
          id: string;
          contaFixaId: string | null;
          competencia: string | null;
          status: string;
          valor: number;
        }>,
      );
    }
    return db.contaPagar.findMany({
      where: {
        contaFixaId: { in: contaFixaIds },
        competencia: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        contaFixaId: true,
        competencia: true,
        status: true,
        valor: true,
      },
    });
  },

  /** Lista ocorrências (ContaPagar) de contas fixas com vencimento no período. */
  listarOcorrenciasNoPeriodo(de: Date, ate: Date) {
    return db.contaPagar.findMany({
      where: {
        contaFixaId: { not: null },
        deletedAt: null,
        vencimento: { gte: de, lte: ate },
        status: { not: StatusConta.CANCELADA },
      },
      orderBy: { vencimento: "asc" },
      include: {
        fornecedor: { select: { id: true, nome: true } },
        categoria: { select: { id: true, nome: true } },
      },
    });
  },

  /** Categoria sentinela usada quando a conta fixa não define categoria. */
  categoriaPadrao() {
    return db.categoria.upsert({
      where: { nome: "Contas Fixas" },
      create: { nome: "Contas Fixas", tipo: "DESPESA" },
      update: {},
    });
  },

  /** Fornecedor sentinela usado quando a conta fixa não define fornecedor. */
  fornecedorPadrao() {
    return db.fornecedor.upsert({
      where: { nome: "Contas Fixas" },
      create: { nome: "Contas Fixas" },
      update: {},
    });
  },

  criarOcorrencia(data: {
    fornecedorId: string;
    categoriaId: string;
    descricao: string;
    valor: number;
    vencimento: Date;
    contaFixaId: string;
    competencia: string;
    observacoes?: string | null;
  }) {
    return db.contaPagar.create({
      data: {
        fornecedorId: data.fornecedorId,
        categoriaId: data.categoriaId,
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento,
        status: StatusConta.ABERTA,
        recorrencia: "NENHUMA",
        contaFixaId: data.contaFixaId,
        competencia: data.competencia,
        observacoes: data.observacoes ?? undefined,
      },
    });
  },
};
