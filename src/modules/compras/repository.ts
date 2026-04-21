import { db } from "@/lib/db";
import type { CriarPedidoCompraInput } from "./schemas";
import { StatusPedidoCompra } from "@/modules/shared/domain";

export const comprasRepository = {
  async listar(filtros: { status?: string }) {
    return db.pedidoCompra.findMany({
      where: {
        ...(filtros.status ? { status: filtros.status } : {}),
      },
      include: {
        fornecedor: { select: { id: true, nome: true } },
        itens: {
          include: {
            produto: { select: { id: true, sku: true, nome: true } },
          },
        },
      },
      orderBy: { dataEmissao: "desc" },
    });
  },

  async buscarPorId(id: string) {
    return db.pedidoCompra.findUnique({
      where: { id },
      include: {
        fornecedor: true,
        contaPagar: true,
        itens: {
          include: {
            produto: {
              select: { id: true, sku: true, nome: true, unidade: true, estoqueAtual: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },

  async criar(input: CriarPedidoCompraInput) {
    const totalCentavos = input.itens.reduce(
      (sum, item) => sum + item.quantidade * item.custoUnitario,
      0,
    );

    return db.pedidoCompra.create({
      data: {
        numero: input.numero ?? null,
        fornecedorId: input.fornecedorId ?? null,
        dataEmissao: new Date(input.dataEmissao),
        dataPrevisao: input.dataPrevisao ? new Date(input.dataPrevisao) : null,
        observacoes: input.observacoes ?? null,
        totalCentavos,
        itens: {
          create: input.itens.map((item) => ({
            produtoId: item.produtoId,
            quantidade: item.quantidade,
            custoUnitario: item.custoUnitario,
            subtotal: item.quantidade * item.custoUnitario,
          })),
        },
      },
      include: {
        itens: { include: { produto: { select: { id: true, sku: true, nome: true } } } },
      },
    });
  },

  async atualizar(id: string, input: Partial<CriarPedidoCompraInput>) {
    const totalCentavos = input.itens
      ? input.itens.reduce((sum, i) => sum + i.quantidade * i.custoUnitario, 0)
      : undefined;

    return db.$transaction(async (tx) => {
      if (input.itens) {
        await tx.itemPedidoCompra.deleteMany({ where: { pedidoId: id } });
      }

      return tx.pedidoCompra.update({
        where: { id },
        data: {
          ...(input.numero !== undefined && { numero: input.numero ?? null }),
          ...(input.fornecedorId !== undefined && {
            fornecedorId: input.fornecedorId ?? null,
          }),
          ...(input.dataEmissao && { dataEmissao: new Date(input.dataEmissao) }),
          ...(input.dataPrevisao !== undefined && {
            dataPrevisao: input.dataPrevisao
              ? new Date(input.dataPrevisao)
              : null,
          }),
          ...(input.observacoes !== undefined && {
            observacoes: input.observacoes ?? null,
          }),
          ...(totalCentavos !== undefined && { totalCentavos }),
          ...(input.itens && {
            itens: {
              create: input.itens.map((item) => ({
                produtoId: item.produtoId,
                quantidade: item.quantidade,
                custoUnitario: item.custoUnitario,
                subtotal: item.quantidade * item.custoUnitario,
              })),
            },
          }),
        },
        include: {
          itens: {
            include: { produto: { select: { id: true, sku: true, nome: true } } },
          },
        },
      });
    });
  },

  async confirmar(id: string, contaPagarId: string | null) {
    return db.pedidoCompra.update({
      where: { id },
      data: {
        status: StatusPedidoCompra.CONFIRMADO,
        ...(contaPagarId ? { contaPagarId } : {}),
      },
    });
  },

  async receber(
    id: string,
    dataRecebimento: Date,
    itens: Array<{ produtoId: string; quantidade: number; custoUnitario: number }>,
  ) {
    return db.$transaction(async (tx) => {
      await tx.pedidoCompra.update({
        where: { id },
        data: {
          status: StatusPedidoCompra.RECEBIDO,
          dataRecebimento,
        },
      });

      for (const item of itens) {
        await tx.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            tipo: "ENTRADA",
            quantidade: item.quantidade,
            custoUnitario: item.custoUnitario || null,
            origem: "COMPRA",
            referenciaId: id,
            dataMovimentacao: dataRecebimento,
          },
        });
        await tx.produto.update({
          where: { id: item.produtoId },
          data: { estoqueAtual: { increment: item.quantidade } },
        });
      }
    });
  },

  async cancelar(id: string) {
    return db.pedidoCompra.update({
      where: { id },
      data: { status: StatusPedidoCompra.CANCELADO },
    });
  },

  async sugestoes() {
    return db.produto.findMany({
      where: {
        ativo: true,
        estoqueMinimo: { gt: 0 },
      },
      select: {
        id: true,
        sku: true,
        asin: true,
        nome: true,
        estoqueAtual: true,
        estoqueMinimo: true,
        custoUnitario: true,
        unidade: true,
      },
      orderBy: { estoqueAtual: "asc" },
    });
  },

  async totais() {
    const [rascunho, confirmado] = await Promise.all([
      db.pedidoCompra.count({ where: { status: StatusPedidoCompra.RASCUNHO } }),
      db.pedidoCompra.aggregate({
        where: { status: StatusPedidoCompra.CONFIRMADO },
        _count: true,
        _sum: { totalCentavos: true },
      }),
    ]);
    return {
      rascunho,
      confirmado: confirmado._count,
      totalComprometidoCentavos: confirmado._sum.totalCentavos ?? 0,
    };
  },
};
