import { estoqueRepository } from "./repository";
import {
  criarProdutoSchema,
  atualizarProdutoSchema,
  criarMovimentacaoEstoqueSchema,
  filtrosProdutoSchema,
  importarProdutosSchema,
  type CriarProdutoInput,
  type AtualizarProdutoInput,
  type CriarMovimentacaoEstoqueInput,
  type FiltrosProdutoInput,
  type ImportarProdutosInput,
} from "./schemas";
import {
  StatusReposicao,
  TipoMovimentacaoEstoque,
  OrigemMovimentacaoEstoque,
} from "@/modules/shared/domain";
import { db } from "@/lib/db";

export function calcularStatusReposicao(
  estoqueAtual: number,
  estoqueMinimo: number,
): StatusReposicao {
  if (estoqueMinimo <= 0) return StatusReposicao.OK;
  if (estoqueAtual <= estoqueMinimo) return StatusReposicao.REPOR;
  if (estoqueAtual <= estoqueMinimo * 1.5) return StatusReposicao.ATENCAO;
  return StatusReposicao.OK;
}

function enriquecerProduto<T extends { estoqueAtual: number; estoqueMinimo: number }>(
  produto: T,
) {
  return {
    ...produto,
    statusReposicao: calcularStatusReposicao(
      produto.estoqueAtual,
      produto.estoqueMinimo,
    ),
  };
}

export const estoqueService = {
  async listarProdutos(filtrosRaw: unknown) {
    const filtros = filtrosProdutoSchema.parse(filtrosRaw);
    const produtos = await estoqueRepository.listarProdutos(filtros);
    const enriquecidos = produtos.map(enriquecerProduto);

    // Ordenar: REPOR primeiro, depois ATENCAO, depois OK
    const ordem: Record<StatusReposicao, number> = {
      REPOR: 0,
      ATENCAO: 1,
      OK: 2,
    };
    enriquecidos.sort(
      (a, b) =>
        ordem[a.statusReposicao] - ordem[b.statusReposicao] ||
        a.nome.localeCompare(b.nome),
    );

    if (filtros.statusReposicao) {
      return enriquecidos.filter(
        (p) => p.statusReposicao === filtros.statusReposicao,
      );
    }

    return enriquecidos;
  },

  async buscarProduto(id: string) {
    const produto = await estoqueRepository.buscarPorId(id);
    if (!produto) return null;
    return enriquecerProduto(produto);
  },

  async criarProduto(input: CriarProdutoInput) {
    const data = criarProdutoSchema.parse(input);
    const existente = await estoqueRepository.buscarPorSku(data.sku);
    if (existente) throw new Error(`SKU "${data.sku}" já cadastrado`);
    return estoqueRepository.criar(data);
  },

  async atualizarProduto(id: string, input: AtualizarProdutoInput) {
    const data = atualizarProdutoSchema.parse(input);
    return estoqueRepository.atualizar(id, data);
  },

  async desativarProduto(id: string) {
    return estoqueRepository.desativar(id);
  },

  async registrarMovimentacao(input: CriarMovimentacaoEstoqueInput) {
    const data = criarMovimentacaoEstoqueSchema.parse(input);
    return estoqueRepository.criarMovimentacao({
      ...data,
      dataMovimentacao: new Date(data.dataMovimentacao),
    });
  },

  async importarProdutos(linhas: ImportarProdutosInput) {
    const dados = importarProdutosSchema.parse(linhas);
    const resultados = { criados: 0, atualizados: 0, erros: [] as string[] };
    const agora = new Date();

    for (const linha of dados) {
      try {
        const existente = await estoqueRepository.buscarPorSku(linha.sku);
        if (existente) {
          await estoqueRepository.atualizar(existente.id, {
            nome: linha.nome,
            asin: linha.asin,
            custoUnitario: linha.custoUnitario,
            estoqueMinimo: linha.estoqueMinimo ?? existente.estoqueMinimo,
            unidade: linha.unidade ?? existente.unidade,
          });

          if (linha.estoqueInicial !== undefined) {
            const diff = linha.estoqueInicial - existente.estoqueAtual;
            if (diff !== 0) {
              await estoqueRepository.criarMovimentacao({
                produtoId: existente.id,
                tipo:
                  diff > 0
                    ? TipoMovimentacaoEstoque.ENTRADA
                    : TipoMovimentacaoEstoque.SAIDA,
                quantidade: Math.abs(diff),
                origem: OrigemMovimentacaoEstoque.IMPORTACAO,
                observacoes: "Importação de saldo inicial",
                dataMovimentacao: agora,
              });
            }
          }

          resultados.atualizados++;
        } else {
          const novo = await estoqueRepository.criar({
            sku: linha.sku,
            asin: linha.asin,
            nome: linha.nome,
            custoUnitario: linha.custoUnitario,
            estoqueMinimo: linha.estoqueMinimo ?? 0,
            unidade: linha.unidade ?? "un",
          });

          if (linha.estoqueInicial && linha.estoqueInicial > 0) {
            await estoqueRepository.criarMovimentacao({
              produtoId: novo.id,
              tipo: TipoMovimentacaoEstoque.ENTRADA,
              quantidade: linha.estoqueInicial,
              origem: OrigemMovimentacaoEstoque.IMPORTACAO,
              observacoes: "Saldo inicial importado",
              dataMovimentacao: agora,
            });
          }

          resultados.criados++;
        }
      } catch (e) {
        resultados.erros.push(
          `SKU ${linha.sku}: ${e instanceof Error ? e.message : "erro desconhecido"}`,
        );
      }
    }

    return resultados;
  },

  async totais() {
    return estoqueRepository.totais();
  },

  listarMovimentacoes(produtoId: string) {
    return estoqueRepository.listarMovimentacoes(produtoId);
  },
};
