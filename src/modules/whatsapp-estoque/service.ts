import { subDays } from "date-fns";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";
import {
  FaixaEstoque,
  FAIXA_ATENCAO_MAX_DIAS,
  FAIXA_CRITICO_MAX_DIAS,
  FAIXA_SEGURO_MIN_DIAS,
} from "./schemas";

// Janela de vendas usada para estimar a velocidade media diaria.
export const JANELA_VENDAS_DIAS = 30;

export type ItemResumoEstoque = {
  produtoId: string;
  sku: string;
  nome: string;
  estoqueAtual: number;
  vendas30d: number;
  // Velocidade media (unidades/dia) e cobertura em dias — valor com decimal,
  // usado para ordenacao precisa. coberturaDias e a versao exibida (floor).
  mediaDia: number;
  diasEstoque: number;
  coberturaDias: number;
  faixa: FaixaEstoque;
};

export type ResumoEstoqueWhatsApp = {
  geradoEm: Date;
  itens: ItemResumoEstoque[];
  porFaixa: Record<FaixaEstoque, ItemResumoEstoque[]>;
  totais: Record<FaixaEstoque, number>;
  totalProdutos: number;
};

export type ProdutoMonitorado = ItemResumoEstoque & { excluido: boolean };

type ProdutoBase = {
  id: string;
  sku: string;
  nome: string;
  estoqueAtual: number;
};

/**
 * Classifica a cobertura de estoque em faixa. Opera sobre o valor arredondado
 * para baixo (mesma logica da cobertura exibida) para alinhar mensagem e faixa.
 */
export function classificarFaixa(diasEstoque: number): FaixaEstoque {
  const dias = Math.floor(diasEstoque);
  if (dias <= FAIXA_CRITICO_MAX_DIAS) return FaixaEstoque.CRITICO;
  if (dias <= FAIXA_ATENCAO_MAX_DIAS) return FaixaEstoque.ATENCAO;
  if (dias < FAIXA_SEGURO_MIN_DIAS) return FaixaEstoque.ESTAVEL;
  return FaixaEstoque.SEGURO;
}

function mapItem(produto: ProdutoBase, vendas30d: number): ItemResumoEstoque {
  const mediaDia = vendas30d / JANELA_VENDAS_DIAS;
  // vendas30d > 0 garantido pelos chamadores, entao mediaDia > 0.
  const diasEstoque = produto.estoqueAtual / mediaDia;
  return {
    produtoId: produto.id,
    sku: produto.sku,
    nome: produto.nome,
    estoqueAtual: produto.estoqueAtual,
    vendas30d,
    mediaDia,
    diasEstoque,
    coberturaDias: Math.floor(diasEstoque),
    faixa: classificarFaixa(diasEstoque),
  };
}

function emptyPorFaixa(): Record<FaixaEstoque, ItemResumoEstoque[]> {
  return {
    [FaixaEstoque.CRITICO]: [],
    [FaixaEstoque.ATENCAO]: [],
    [FaixaEstoque.ESTAVEL]: [],
    [FaixaEstoque.SEGURO]: [],
  };
}

/**
 * Monta o resumo a partir de dados ja carregados (puro, testavel sem DB).
 * Regras: so entram produtos com venda 30d >= 1 e que nao estejam excluidos.
 * Ordenacao global por menor cobertura (cada faixa herda a ordem por ser estavel).
 */
export function montarResumoDeDados(input: {
  produtos: ProdutoBase[];
  vendasPorSku: Map<string, number>;
  excluidosIds: Set<string>;
  geradoEm?: Date;
}): ResumoEstoqueWhatsApp {
  const geradoEm = input.geradoEm ?? new Date();
  const itens: ItemResumoEstoque[] = [];

  for (const produto of input.produtos) {
    if (input.excluidosIds.has(produto.id)) continue;
    const vendas30d = input.vendasPorSku.get(produto.sku) ?? 0;
    if (vendas30d <= 0) continue;
    itens.push(mapItem(produto, vendas30d));
  }

  itens.sort((a, b) => a.diasEstoque - b.diasEstoque);

  const porFaixa = emptyPorFaixa();
  for (const item of itens) porFaixa[item.faixa].push(item);

  const totais: Record<FaixaEstoque, number> = {
    [FaixaEstoque.CRITICO]: porFaixa.CRITICO.length,
    [FaixaEstoque.ATENCAO]: porFaixa.ATENCAO.length,
    [FaixaEstoque.ESTAVEL]: porFaixa.ESTAVEL.length,
    [FaixaEstoque.SEGURO]: porFaixa.SEGURO.length,
  };

  return { geradoEm, itens, porFaixa, totais, totalProdutos: itens.length };
}

async function carregarDadosEstoque(geradoEm: Date) {
  const desde = subDays(geradoEm, JANELA_VENDAS_DIAS);
  const [produtos, vendas30d, excluidos] = await Promise.all([
    db.produto.findMany({
      where: { ativo: true },
      select: { id: true, sku: true, nome: true, estoqueAtual: true },
    }),
    db.vendaAmazon.groupBy({
      by: ["sku"],
      where: whereVendaAmazonContabilizavelEstrito({ dataVenda: { gte: desde } }),
      _sum: { quantidade: true },
    }),
    db.whatsAppEstoqueProdutoExcluido.findMany({ select: { produtoId: true } }),
  ]);

  const vendasPorSku = new Map<string, number>(
    vendas30d.map((v) => [v.sku, v._sum.quantidade ?? 0]),
  );
  const excluidosIds = new Set(excluidos.map((e) => e.produtoId));

  return { produtos, vendasPorSku, excluidosIds };
}

/**
 * Resumo completo para envio (exclui SKUs desativados do resumo).
 */
export async function obterResumoEstoqueWhatsApp(
  geradoEm = new Date(),
): Promise<ResumoEstoqueWhatsApp> {
  const { produtos, vendasPorSku, excluidosIds } =
    await carregarDadosEstoque(geradoEm);
  return montarResumoDeDados({ produtos, vendasPorSku, excluidosIds, geradoEm });
}

/**
 * Lista de produtos elegiveis (ativos com venda 30d) para a tela de gestao.
 * Inclui os excluidos (marcados) para permitir reativacao. Filtra por SKU/nome.
 */
export async function listarProdutosMonitorados(
  busca?: string,
): Promise<ProdutoMonitorado[]> {
  const { produtos, vendasPorSku, excluidosIds } =
    await carregarDadosEstoque(new Date());
  const termo = busca?.trim().toLowerCase();

  const lista: ProdutoMonitorado[] = [];
  for (const produto of produtos) {
    const vendas30d = vendasPorSku.get(produto.sku) ?? 0;
    if (vendas30d <= 0) continue;
    if (
      termo &&
      !produto.sku.toLowerCase().includes(termo) &&
      !produto.nome.toLowerCase().includes(termo)
    ) {
      continue;
    }
    lista.push({
      ...mapItem(produto, vendas30d),
      excluido: excluidosIds.has(produto.id),
    });
  }

  lista.sort((a, b) => a.diasEstoque - b.diasEstoque);
  return lista;
}

export async function excluirProdutoDoResumo(
  produtoId: string,
  sku: string,
): Promise<void> {
  await db.whatsAppEstoqueProdutoExcluido.upsert({
    where: { produtoId },
    create: { produtoId, sku },
    update: { sku },
  });
}

export async function reativarProdutoNoResumo(produtoId: string): Promise<void> {
  await db.whatsAppEstoqueProdutoExcluido.deleteMany({ where: { produtoId } });
}
