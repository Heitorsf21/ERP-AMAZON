import { db } from "@/lib/db";
import type {
  CriarProdutoInput,
  AtualizarProdutoInput,
  FiltrosProdutoInput,
} from "./schemas";
import {
  StatusReposicao,
  TipoMovimentacaoEstoque,
} from "@/modules/shared/domain";
import { EstoqueFiltroOperacional } from "./filtros";
import type { Prisma } from "@prisma/client";

type ProdutoComCustoFallback = {
  id: string;
  custoUnitario: number | null;
};

type ProdutoComReposicao = {
  estoqueAtual: number;
  estoqueMinimo: number;
};

type ProdutoParaResumo = ProdutoComCustoFallback &
  ProdutoComReposicao & {
    ativo: boolean;
    amazonEstoqueDisponivel: number | null;
    amazonPrecoListagemCentavos: number | null;
    precoVenda: number | null;
  };

function valorPositivo(valor: number | null | undefined) {
  return valor != null && valor > 0 ? valor : null;
}

function calcularStatusReposicaoLocal(
  estoqueAtual: number,
  estoqueMinimo: number,
): StatusReposicao {
  if (estoqueMinimo <= 0) return StatusReposicao.OK;
  if (estoqueAtual <= estoqueMinimo) return StatusReposicao.REPOR;
  if (estoqueAtual <= estoqueMinimo * 1.5) return StatusReposicao.ATENCAO;
  return StatusReposicao.OK;
}

function calcularQuantidadeVendavel({
  amazonEstoqueDisponivel,
  estoqueAtual,
}: {
  amazonEstoqueDisponivel: number | null;
  estoqueAtual: number;
}) {
  if (amazonEstoqueDisponivel != null) {
    return Math.max(0, amazonEstoqueDisponivel);
  }

  return Math.max(0, estoqueAtual);
}

export function montarWhereProdutos(
  filtros: Partial<FiltrosProdutoInput>,
): Prisma.ProdutoWhereInput | undefined {
  const AND: Prisma.ProdutoWhereInput[] = [];

  if (filtros.ativo !== undefined) AND.push({ ativo: filtros.ativo });
  if (!filtros.incluirNaoMfs) AND.push({ sku: { startsWith: "MFS-" } });

  if (filtros.estoque === EstoqueFiltroOperacional.COM_ESTOQUE) {
    AND.push({
      OR: [
        { amazonEstoqueDisponivel: { gt: 0 } },
        { estoqueAtual: { gt: 0 } },
      ],
    });
  }

  if (filtros.estoque === EstoqueFiltroOperacional.SEM_ESTOQUE) {
    AND.push({
      estoqueAtual: { lte: 0 },
      OR: [
        { amazonEstoqueDisponivel: null },
        { amazonEstoqueDisponivel: { lte: 0 } },
      ],
    });
  }

  if (filtros.semSyncAmazon) {
    AND.push({ amazonEstoqueDisponivel: null });
  }

  // Compatibilidade com filtros antigos ainda usados por outras telas.
  if (filtros.temCusto === true) AND.push({ custoUnitario: { gt: 0 } });
  if (filtros.temCusto === false) {
    AND.push({ OR: [{ custoUnitario: null }, { custoUnitario: 0 }] });
  }

  if (filtros.busca) {
    AND.push({
      OR: [
        { sku: { contains: filtros.busca } },
        { nome: { contains: filtros.busca } },
        { asin: { contains: filtros.busca } },
      ],
    });
  }

  return AND.length ? { AND } : undefined;
}

export async function resolverCustosVigentesProdutos<
  T extends ProdutoComCustoFallback,
>(produtos: T[], dataReferencia = new Date()) {
  const custos = new Map<string, number>();
  if (produtos.length === 0) return custos;

  const produtoIds = [...new Set(produtos.map((p) => p.id))];
  const vigencias = await db.produtoCustoHistorico.findMany({
    where: {
      produtoId: { in: produtoIds },
      vigenciaInicio: { lte: dataReferencia },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: dataReferencia } }],
    },
    select: {
      produtoId: true,
      custoCentavos: true,
      vigenciaInicio: true,
    },
    orderBy: [{ produtoId: "asc" }, { vigenciaInicio: "desc" }],
  });

  for (const vigencia of vigencias) {
    if (!custos.has(vigencia.produtoId) && vigencia.custoCentavos > 0) {
      custos.set(vigencia.produtoId, vigencia.custoCentavos);
    }
  }

  for (const produto of produtos) {
    if (custos.has(produto.id)) continue;
    const fallback = valorPositivo(produto.custoUnitario);
    if (fallback) custos.set(produto.id, fallback);
  }

  return custos;
}

export function filtrarProdutosDerivados<
  T extends ProdutoComCustoFallback & ProdutoComReposicao,
>(
  produtos: T[],
  custosVigentes: Map<string, number>,
  filtros: Partial<FiltrosProdutoInput>,
) {
  let filtrados = produtos;

  if (filtros.semCusto) {
    filtrados = filtrados.filter((p) => !custosVigentes.has(p.id));
  }

  if (filtros.statusReposicao) {
    filtrados = filtrados.filter(
      (p) =>
        calcularStatusReposicaoLocal(p.estoqueAtual, p.estoqueMinimo) ===
        filtros.statusReposicao,
    );
  }

  return filtrados;
}

export function calcularResumoEstoque(
  produtos: ProdutoParaResumo[],
  custosVigentes: Map<string, number>,
) {
  let custoEstoqueCentavos = 0;
  let receitaPotencialCentavos = 0;
  let unidadesVendaveis = 0;
  let unidadesSemCusto = 0;
  let unidadesSemPreco = 0;
  let countRepor = 0;
  let countAtencao = 0;
  let produtosSemCusto = 0;
  let produtosSemPreco = 0;
  let produtosSemSyncAmazon = 0;

  for (const p of produtos) {
    const status = calcularStatusReposicaoLocal(p.estoqueAtual, p.estoqueMinimo);
    if (status === StatusReposicao.REPOR) countRepor++;
    if (status === StatusReposicao.ATENCAO) countAtencao++;

    if (p.amazonEstoqueDisponivel == null) {
      produtosSemSyncAmazon++;
    }

    const quantidadeVendavel = calcularQuantidadeVendavel(p);
    if (quantidadeVendavel <= 0) continue;

    unidadesVendaveis += quantidadeVendavel;

    const custo = custosVigentes.get(p.id);
    if (custo) {
      custoEstoqueCentavos += quantidadeVendavel * custo;
    } else {
      produtosSemCusto++;
      unidadesSemCusto += quantidadeVendavel;
    }

    const preco =
      valorPositivo(p.amazonPrecoListagemCentavos) ?? valorPositivo(p.precoVenda);
    if (preco) {
      receitaPotencialCentavos += quantidadeVendavel * preco;
    } else {
      produtosSemPreco++;
      unidadesSemPreco += quantidadeVendavel;
    }
  }

  return {
    total: produtos.length,
    inativos: produtos.filter((p) => !p.ativo).length,
    countRepor,
    countAtencao,
    valorTotalCentavos: custoEstoqueCentavos,
    custoEstoqueCentavos,
    receitaPotencialCentavos,
    unidadesVendaveis,
    produtosSemCusto,
    unidadesSemCusto,
    produtosSemPreco,
    unidadesSemPreco,
    produtosSemSyncAmazon,
  };
}

export const estoqueRepository = {
  async listarProdutos(filtros: FiltrosProdutoInput) {
    return db.produto.findMany({
      where: montarWhereProdutos(filtros),
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
    return db.produto.findFirst({ where: { sku } });
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

  async resolverCustosVigentes<T extends ProdutoComCustoFallback>(
    produtos: T[],
  ) {
    return resolverCustosVigentesProdutos(produtos);
  },

  async totais(filtros: FiltrosProdutoInput) {
    const produtos = await db.produto.findMany({
      where: montarWhereProdutos(filtros),
      select: {
        id: true,
        ativo: true,
        estoqueAtual: true,
        estoqueMinimo: true,
        custoUnitario: true,
        amazonEstoqueDisponivel: true,
        amazonPrecoListagemCentavos: true,
        precoVenda: true,
      },
    });

    const custos = await resolverCustosVigentesProdutos(produtos);
    const filtrados = filtrarProdutosDerivados(produtos, custos, filtros);

    return calcularResumoEstoque(filtrados, custos);
  },
};
