import { db } from "@/lib/db";
import { comprasRepository } from "./repository";
import {
  criarPedidoCompraSchema,
  atualizarPedidoCompraSchema,
  confirmarPedidoSchema,
  receberPedidoSchema,
  type CriarPedidoCompraInput,
  type ConfirmarPedidoInput,
  type ReceberPedidoInput,
} from "./schemas";
import { StatusPedidoCompra, StatusReposicao } from "@/modules/shared/domain";
import { addDays } from "date-fns";

export const comprasService = {
  async listar(filtros: { status?: string }) {
    return comprasRepository.listar(filtros);
  },

  async buscar(id: string) {
    const pedido = await comprasRepository.buscarPorId(id);
    if (!pedido) throw new Error("Pedido não encontrado");
    return pedido;
  },

  async criar(raw: unknown) {
    const input = criarPedidoCompraSchema.parse(raw);
    // Valida que todos os produtos existem
    for (const item of input.itens) {
      const produto = await db.produto.findUnique({ where: { id: item.produtoId } });
      if (!produto) throw new Error(`Produto ${item.produtoId} não encontrado`);
    }
    return comprasRepository.criar(input);
  },

  async atualizar(id: string, raw: unknown) {
    const pedido = await comprasRepository.buscarPorId(id);
    if (!pedido) throw new Error("Pedido não encontrado");
    if (pedido.status !== StatusPedidoCompra.RASCUNHO) {
      throw new Error("Apenas pedidos em rascunho podem ser editados");
    }
    const input = atualizarPedidoCompraSchema.parse(raw);
    return comprasRepository.atualizar(id, input);
  },

  async confirmar(id: string, raw: unknown) {
    const input = confirmarPedidoSchema.parse(raw);
    const pedido = await comprasRepository.buscarPorId(id);
    if (!pedido) throw new Error("Pedido não encontrado");
    if (pedido.status !== StatusPedidoCompra.RASCUNHO) {
      throw new Error("Apenas rascunhos podem ser confirmados");
    }

    let contaPagarId: string | null = null;

    if (input.criarContaPagar && pedido.totalCentavos > 0) {
      const categorias = await db.categoria.findMany({
        where: { tipo: { in: ["DESPESA", "AMBAS"] } },
        take: 1,
        orderBy: { nome: "asc" },
      });
      const categoriaMercadoria = await db.categoria.findFirst({
        where: { nome: { contains: "mercadoria" } },
      });
      const categoriaId =
        categoriaMercadoria?.id ?? categorias[0]?.id;

      if (categoriaId) {
        // Precisa de fornecedor para ContaPagar (campo obrigatório)
        let fornecedorId = pedido.fornecedorId;
        if (!fornecedorId) {
          const fornecedorGenerico = await db.fornecedor.findFirst({
            where: { nome: "Fornecedor Genérico" },
          });
          if (fornecedorGenerico) {
            fornecedorId = fornecedorGenerico.id;
          } else {
            const novoFornecedor = await db.fornecedor.create({
              data: { nome: "Fornecedor Genérico" },
            });
            fornecedorId = novoFornecedor.id;
          }
        }

        const vencimento = input.vencimento
          ? new Date(input.vencimento)
          : pedido.dataPrevisao ?? addDays(new Date(), 15);

        const conta = await db.contaPagar.create({
          data: {
            fornecedorId,
            categoriaId,
            descricao: `Compra #${pedido.numero ?? pedido.id.slice(0, 8)}`,
            valor: pedido.totalCentavos,
            vencimento,
            status: "ABERTA",
          },
        });
        contaPagarId = conta.id;
      }
    }

    return comprasRepository.confirmar(id, contaPagarId);
  },

  async receber(id: string, raw: unknown) {
    const input = receberPedidoSchema.parse(raw);
    const pedido = await comprasRepository.buscarPorId(id);
    if (!pedido) throw new Error("Pedido não encontrado");
    if (pedido.status !== StatusPedidoCompra.CONFIRMADO) {
      throw new Error("Apenas pedidos confirmados podem ser recebidos");
    }

    const dataRecebimento = new Date(input.dataRecebimento);
    const itens = pedido.itens.map((item) => ({
      produtoId: item.produtoId,
      quantidade: item.quantidade,
      custoUnitario: item.custoUnitario,
    }));

    return comprasRepository.receber(id, dataRecebimento, itens);
  },

  async cancelar(id: string) {
    const pedido = await comprasRepository.buscarPorId(id);
    if (!pedido) throw new Error("Pedido não encontrado");
    if (pedido.status === StatusPedidoCompra.RECEBIDO) {
      throw new Error("Pedidos recebidos não podem ser cancelados");
    }
    return comprasRepository.cancelar(id);
  },

  async sugestoes() {
    const produtos = await comprasRepository.sugestoes();
    return produtos
      .map((p) => {
        let statusReposicao: string = StatusReposicao.OK;
        if (p.estoqueMinimo > 0) {
          if (p.estoqueAtual <= p.estoqueMinimo) statusReposicao = StatusReposicao.REPOR;
          else if (p.estoqueAtual <= p.estoqueMinimo * 1.5)
            statusReposicao = StatusReposicao.ATENCAO;
        }
        return { ...p, statusReposicao };
      })
      .filter((p) => p.statusReposicao !== StatusReposicao.OK);
  },

  async totais() {
    return comprasRepository.totais();
  },
};
