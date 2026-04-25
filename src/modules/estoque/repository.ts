import { db } from "@/lib/db";
import type {
  CriarProdutoInput,
  AtualizarProdutoInput,
} from "./schemas";
import { TipoMovimentacaoEstoque } from "@/modules/shared/domain";

export const estoqueRepository = {
  async listarProdutos(filtros: {
    busca?: string;
    ativo?: boolean;
    incluirNaoMfs?: boolean;
  }) {
    return db.produto.findMany({
      where: {
        // Quando filtros.ativo === undefined, NAO filtra (mostra todos).
        // Quando true, mostra so ativos. Quando false, mostra so inativos.
        ...(filtros.ativo !== undefined ? { ativo: filtros.ativo } : {}),
        // Por padrao mostramos apenas SKUs que comecam com MFS-.
        // Passe incluirNaoMfs=true para listar TODOS (admin/debug).
        ...(filtros.incluirNaoMfs ? {} : { sku: { startsWith: "MFS-" } }),
        ...(filtros.busca
          ? {
              OR: [
                { sku: { contains: filtros.busca } },
                { nome: { contains: filtros.busca } },
                { asin: { contains: filtros.busca } },
              ],
            }
          : {}),
      },
      orderBy: { nome: "asc" },
    });
  },

  async buscarPorId(id: string) {
    return db.produto.findUnique({
      where: { id },
      include: {
        movimentacoes: {
          orderBy: { dataMovimentacao: "desc" },
          take: 30,
        },
      },
    });
  },

  async buscarPorSku(sku: string) {
    return db.produto.findUnique({ where: { sku } });
  },

  async criar(data: CriarProdutoInput) {
    return db.produto.create({ data: { ...data, estoqueAtual: 0 } });
  },

  async atualizar(id: string, data: AtualizarProdutoInput) {
    return db.produto.update({ where: { id }, data });
  },

  async desativar(id: string) {
    return db.produto.update({ where: { id }, data: { ativo: false } });
  },

  async criarMovimentacao(input: {
    produtoId: string;
    tipo: string;
    quantidade: number;
    custoUnitario?: number | null;
    origem: string;
    observacoes?: string | null;
    dataMovimentacao: Date;
  }) {
    const delta =
      input.tipo === TipoMovimentacaoEstoque.ENTRADA
        ? input.quantidade
        : -input.quantidade;

    const [mov] = await db.$transaction([
      db.movimentacaoEstoque.create({
        data: {
          produtoId: input.produtoId,
          tipo: input.tipo,
          quantidade: input.quantidade,
          custoUnitario: input.custoUnitario ?? null,
          origem: input.origem,
          observacoes: input.observacoes ?? null,
          dataMovimentacao: input.dataMovimentacao,
        },
      }),
      db.produto.update({
        where: { id: input.produtoId },
        data: { estoqueAtual: { increment: delta } },
      }),
    ]);

    return mov;
  },

  async listarMovimentacoes(produtoId: string) {
    return db.movimentacaoEstoque.findMany({
      where: { produtoId },
      orderBy: { dataMovimentacao: "desc" },
      take: 100,
    });
  },

  async totais() {
    const [total, inativos] = await Promise.all([
      db.produto.count({ where: { ativo: true } }),
      db.produto.count({ where: { ativo: false } }),
    ]);

    const produtos = await db.produto.findMany({
      where: { ativo: true },
      select: {
        estoqueAtual: true,
        estoqueMinimo: true,
        custoUnitario: true,
      },
    });

    let valorTotalCentavos = 0;
    let countRepor = 0;
    let countAtencao = 0;

    for (const p of produtos) {
      if (p.custoUnitario) {
        valorTotalCentavos += p.estoqueAtual * p.custoUnitario;
      }
      if (p.estoqueMinimo > 0) {
        if (p.estoqueAtual <= p.estoqueMinimo) countRepor++;
        else if (p.estoqueAtual <= p.estoqueMinimo * 1.5) countAtencao++;
      }
    }

    return { total, inativos, countRepor, countAtencao, valorTotalCentavos };
  },
};
