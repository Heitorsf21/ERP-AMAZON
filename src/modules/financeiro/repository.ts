import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { TipoMovimentacao } from "@/modules/shared/domain";
import type { FiltrosMovimentacao } from "./schemas";

type PrismaTx = PrismaClient | Prisma.TransactionClient;

function construirWhere(
  filtros: FiltrosMovimentacao,
): Prisma.MovimentacaoWhereInput {
  const where: Prisma.MovimentacaoWhereInput = {};
  if (filtros.tipo) where.tipo = filtros.tipo;
  if (filtros.categoriaId) where.categoriaId = filtros.categoriaId;
  if (filtros.origem) where.origem = filtros.origem;
  if (filtros.de || filtros.ate) {
    where.dataCaixa = {};
    if (filtros.de) where.dataCaixa.gte = filtros.de;
    if (filtros.ate) where.dataCaixa.lte = filtros.ate;
  }
  return where;
}

export const movimentacaoRepository = {
  async listar(filtros: FiltrosMovimentacao) {
    return db.movimentacao.findMany({
      where: construirWhere(filtros),
      include: { categoria: true },
      orderBy: [{ dataCaixa: "desc" }, { createdAt: "desc" }],
    });
  },

  async criar(
    data: Prisma.MovimentacaoCreateInput,
    tx: PrismaTx = db,
  ) {
    return tx.movimentacao.create({ data, include: { categoria: true } });
  },

  async criarMuitas(
    dados: Prisma.MovimentacaoCreateManyInput[],
    tx: PrismaTx = db,
  ) {
    return tx.movimentacao.createMany({ data: dados });
  },

  async remover(id: string) {
    return db.movimentacao.delete({ where: { id } });
  },

  /**
   * Soma de movimentações realizadas. Entradas somam, saídas subtraem.
   * Filtros opcionais: até uma data (para saldo histórico) ou por período.
   */
  async somarSaldo(filtros: FiltrosMovimentacao = {}): Promise<number> {
    const where = construirWhere(filtros);
    const [entradas, saidas] = await Promise.all([
      db.movimentacao.aggregate({
        where: { ...where, tipo: TipoMovimentacao.ENTRADA },
        _sum: { valor: true },
      }),
      db.movimentacao.aggregate({
        where: { ...where, tipo: TipoMovimentacao.SAIDA },
        _sum: { valor: true },
      }),
    ]);
    return (entradas._sum.valor ?? 0) - (saidas._sum.valor ?? 0);
  },
};
