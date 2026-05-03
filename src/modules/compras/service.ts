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
import { whereVendaAmazonContabilizavel } from "@/modules/vendas/filtros";
import { addDays, subDays } from "date-fns";

const COBERTURA_DIAS = 60;
const URGENTE_DIAS = 15;

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
    const desde = subDays(new Date(), 30);

    const [produtos, vendas30d] = await Promise.all([
      db.produto.findMany({
        where: { ativo: true },
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
      }),
      db.vendaAmazon.groupBy({
        by: ["sku"],
        where: whereVendaAmazonContabilizavel({
          dataVenda: { gte: desde },
        }),
        _sum: { quantidade: true },
      }),
    ]);

    const vendasPorSku = new Map(
      vendas30d.map((v) => [v.sku, v._sum.quantidade ?? 0]),
    );

    const hoje = new Date();

    const sugestoes = produtos
      .map((p) => {
        const vendido30d = vendasPorSku.get(p.sku) ?? 0;
        const unidadesPorDia = vendido30d / 30;
        const diasEstoque =
          unidadesPorDia > 0
            ? Math.floor(p.estoqueAtual / unidadesPorDia)
            : null;

        // Prioridade pela velocidade de vendas
        let statusReposicao: string = StatusReposicao.OK;
        if (diasEstoque !== null) {
          if (diasEstoque < URGENTE_DIAS) statusReposicao = StatusReposicao.REPOR;
          else if (diasEstoque < COBERTURA_DIAS) statusReposicao = StatusReposicao.ATENCAO;
        } else if (p.estoqueMinimo > 0) {
          // Fallback: sem dados de velocidade, usa estoqueMinimo
          if (p.estoqueAtual <= p.estoqueMinimo) statusReposicao = StatusReposicao.REPOR;
          else if (p.estoqueAtual <= p.estoqueMinimo * 1.5)
            statusReposicao = StatusReposicao.ATENCAO;
        }

        // Quantidade sugerida para cobertura de 60 dias
        const qtdSugerida =
          unidadesPorDia > 0
            ? Math.max(0, Math.ceil(COBERTURA_DIAS * unidadesPorDia) - p.estoqueAtual)
            : p.estoqueMinimo > 0
              ? Math.max(p.estoqueMinimo * 2 - p.estoqueAtual, p.estoqueMinimo)
              : 0;

        // Data estimada de ruptura
        const dataRuptura =
          diasEstoque !== null
            ? new Date(hoje.getTime() + diasEstoque * 86_400_000).toISOString()
            : null;

        return {
          ...p,
          statusReposicao,
          vendido30d,
          unidadesPorDia: Math.round(unidadesPorDia * 10) / 10,
          diasEstoque,
          dataRuptura,
          qtdSugerida,
        };
      })
      .filter((p) => p.statusReposicao !== StatusReposicao.OK);

    // Ordena: REPOR (urgente) primeiro, depois ATENCAO; dentro de cada grupo por diasEstoque asc
    return sugestoes.sort((a, b) => {
      if (a.statusReposicao !== b.statusReposicao) {
        return a.statusReposicao === StatusReposicao.REPOR ? -1 : 1;
      }
      const dA = a.diasEstoque ?? 9999;
      const dB = b.diasEstoque ?? 9999;
      return dA - dB;
    });
  },

  async totais() {
    return comprasRepository.totais();
  },
};
