import { db } from "@/lib/db";
import type { FiltrosConta } from "./schemas";

export const contasRepository = {
  async listar(filtros: FiltrosConta = {}) {
    const where: Record<string, unknown> = {};

    if (filtros.status) {
      where.status = filtros.status;
    }
    if (filtros.fornecedorId) {
      where.fornecedorId = filtros.fornecedorId;
    }
    if (filtros.categoriaId) {
      where.categoriaId = filtros.categoriaId;
    }
    if (filtros.de || filtros.ate) {
      const range: { gte?: Date; lte?: Date } = {};
      if (filtros.de) range.gte = new Date(filtros.de + "T00:00:00-03:00");
      if (filtros.ate) range.lte = new Date(filtros.ate + "T23:59:59-03:00");
      where.vencimento = range;
    }

    return db.contaPagar.findMany({
      where,
      orderBy: { vencimento: "asc" },
      include: {
        fornecedor: { select: { id: true, nome: true } },
        categoria: { select: { id: true, nome: true } },
        dossieFinanceiro: {
          include: {
            documentos: {
              select: { id: true, tipo: true, nomeArquivo: true },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
  },

  async buscarPorId(id: string) {
    return db.contaPagar.findUnique({
      where: { id },
      include: {
        fornecedor: { select: { id: true, nome: true, documento: true } },
        categoria: { select: { id: true, nome: true } },
        dossieFinanceiro: {
          include: {
            documentos: {
              select: { id: true, tipo: true, nomeArquivo: true },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });
  },

  async listarParaDocumento() {
    return db.contaPagar.findMany({
      where: {
        status: { not: "CANCELADA" },
      },
      orderBy: [{ updatedAt: "desc" }, { vencimento: "desc" }],
      take: 200,
      include: {
        fornecedor: { select: { id: true, nome: true, documento: true } },
        categoria: { select: { id: true, nome: true } },
      },
    });
  },

  async criar(data: {
    fornecedorId: string;
    categoriaId: string;
    descricao: string;
    valor: number;
    vencimento: Date;
    recorrencia: string;
    observacoes?: string;
    contaPaiId?: string;
    nfAnexo?: string;
    nfNome?: string;
  }) {
    return db.contaPagar.create({ data });
  },

  async atualizar(id: string, data: Partial<{
    status: string;
    pagoEm: Date;
    movimentacaoId: string;
    nfAnexo: string | null;
    nfNome: string | null;
  }>) {
    return db.contaPagar.update({ where: { id }, data });
  },

  async deletar(id: string) {
    return db.contaPagar.delete({ where: { id } });
  },

  // Marca contas ABERTA com vencimento passado como VENCIDA.
  async atualizarVencidas() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return db.contaPagar.updateMany({
      where: { status: "ABERTA", vencimento: { lt: hoje } },
      data: { status: "VENCIDA" },
    });
  },

  async upsertFornecedor(nome: string, documento?: string) {
    const existing = await db.fornecedor.findFirst({
      where: { nome: { equals: nome } },
    });
    if (existing) {
      if (documento && !existing.documento) {
        return db.fornecedor.update({
          where: { id: existing.id },
          data: { documento },
        });
      }
      return existing;
    }
    return db.fornecedor.create({ data: { nome, documento } });
  },

  async listarFornecedores(busca?: string) {
    return db.fornecedor.findMany({
      where: busca
        ? { nome: { contains: busca } }
        : undefined,
      orderBy: { nome: "asc" },
    });
  },
};
