import { db } from "@/lib/db";
import { somarDias } from "@/lib/date";
import {
  OrigemContaReceber,
  OrigemMovimentacao,
  StatusContaReceber,
  TipoCategoria,
  TipoMovimentacao,
} from "@/modules/shared/domain";
import {
  parseAmazonCSV,
  resumirImportacao,
  type ResumoImportacao,
} from "./amazon-parser";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";

// Ciclo médio observado nos relatórios: ~14 dias do pedido até transferência.
const CICLO_LIQUIDACAO_DIAS = 14;

/**
 * Resolve (find-or-create) a categoria de RECEITA usada na entrada de caixa
 * gerada ao marcar uma conta a receber como recebida. AMAZON → "Pagamento
 * Amazon"; MANUAL → "Outras receitas". A extensão multi-tenant injeta empresaId.
 */
async function resolverCategoriaReceitaId(origem: string): Promise<string> {
  const nome =
    origem === OrigemContaReceber.AMAZON
      ? "Pagamento Amazon"
      : "Outras receitas";
  const existente = await db.categoria.findFirst({ where: { nome } });
  if (existente) return existente.id;
  const criada = await db.categoria.create({
    data: { nome, tipo: TipoCategoria.RECEITA },
  });
  return criada.id;
}

export const contasReceberService = {
  /**
   * Importa o CSV Amazon Unified Transaction e cria/atualiza ContaReceber
   * para cada liquidação com pedidos diferidos (pendentes de transferência).
   *
   * Retorna o resumo da importação para o frontend exibir.
   */
  async importarAmazonCSV(
    conteudo: string | Buffer | Uint8Array,
  ): Promise<ResumoImportacao> {
    // Aceita Buffer (vindo da Reports API automatizada) ou string (upload manual).
    const conteudoStr =
      typeof conteudo === "string"
        ? conteudo
        : Buffer.from(conteudo).toString("utf8");

    const transacoes = parseAmazonCSV(conteudoStr);
    if (transacoes.length === 0) {
      throw new Error("Nenhuma transação encontrada no CSV");
    }

    const resumo = resumirImportacao(transacoes);
    await dashboardEcommerceService.importarVendasAmazonCSV(conteudoStr);

    // Cria/atualiza ContaReceber para liquidações pendentes ou parciais
    for (const liq of resumo.liquidacoes) {
      if (liq.totalPedidos === 0) continue;

      const existente = await db.contaReceber.findFirst({
        where: { liquidacaoId: liq.liquidacaoId },
      });

      if (liq.status === "TRANSFERIDO") {
        // Liquidação já transferida — marca como RECEBIDA se existia
        if (existente && existente.status === StatusContaReceber.PENDENTE) {
          await db.contaReceber.update({
            where: { id: existente.id },
            data: {
              status: StatusContaReceber.RECEBIDA,
              dataRecebimento: liq.dataTransferencia,
              valor: liq.totalTransferidoCentavos,
            },
          });
        }
        continue;
      }

      // PENDENTE ou PARCIAL — valor a receber é a diferença
      const valorPendente =
        liq.totalLiquidoCentavos - liq.totalTransferidoCentavos;
      if (valorPendente <= 0) continue;

      // Estimar data de recebimento com base no ciclo médio
      const dataPrevisao = somarDias(liq.ultimaData, CICLO_LIQUIDACAO_DIAS);

      const descricao = `Amazon Liquidação ${liq.liquidacaoId} (${liq.totalPedidos} pedidos)`;

      if (existente) {
        // Para liquidações PENDENTE que aparecem em múltiplos relatórios (ex: março
        // e abril-parcial), usamos o MAIOR valor/contagem já conhecido para não
        // perder dados de períodos anteriores mais completos.
        const novoValor = Math.max(existente.valor, valorPendente);
        const novoPedidos = Math.max(existente.totalPedidos, liq.totalPedidos);
        await db.contaReceber.update({
          where: { id: existente.id },
          data: {
            valor: novoValor,
            totalPedidos: novoPedidos,
            dataPrevisao,
            descricao: `Amazon Liquidação ${liq.liquidacaoId} (${novoPedidos} pedidos)`,
          },
        });
      } else {
        await db.contaReceber.create({
          data: {
            descricao,
            valor: valorPendente,
            dataPrevisao,
            status: StatusContaReceber.PENDENTE,
            origem: OrigemContaReceber.AMAZON,
            liquidacaoId: liq.liquidacaoId,
            totalPedidos: liq.totalPedidos,
          },
        });
      }
    }

    return resumo;
  },

  /** Lista todas as contas a receber, mais recentes primeiro. */
  async listar(filtroStatus?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filtroStatus) where.status = filtroStatus;
    return db.contaReceber.findMany({
      where,
      orderBy: { dataPrevisao: "asc" },
    });
  },

  /**
   * Totais agregados por status (PENDENTE + RECEBIDA), com "% recebido" e
   * separação por origem (Amazon × Outros). Campos antigos preservados.
   */
  async totais() {
    const [pendentes, recebidas] = await Promise.all([
      db.contaReceber.findMany({
        where: { status: StatusContaReceber.PENDENTE, deletedAt: null },
        select: { valor: true, origem: true },
      }),
      db.contaReceber.findMany({
        where: { status: StatusContaReceber.RECEBIDA, deletedAt: null },
        select: { valor: true, origem: true },
      }),
    ]);

    const soma = (
      arr: Array<{ valor: number; origem: string }>,
      origem?: string,
    ) =>
      arr
        .filter((c) => !origem || c.origem === origem)
        .reduce((s, c) => s + c.valor, 0);

    const totalPendenteCentavos = soma(pendentes);
    const totalRecebidaCentavos = soma(recebidas);
    const totalCentavos = totalPendenteCentavos + totalRecebidaCentavos;
    const percentualRecebido =
      totalCentavos > 0 ? (totalRecebidaCentavos / totalCentavos) * 100 : 0;

    return {
      totalPendenteCentavos,
      quantidadePendente: pendentes.length,
      totalRecebidaCentavos,
      quantidadeRecebida: recebidas.length,
      totalCentavos,
      percentualRecebido,
      amazon: {
        pendenteCentavos: soma(pendentes, OrigemContaReceber.AMAZON),
        recebidaCentavos: soma(recebidas, OrigemContaReceber.AMAZON),
      },
      outros: {
        pendenteCentavos: soma(pendentes, OrigemContaReceber.MANUAL),
        recebidaCentavos: soma(recebidas, OrigemContaReceber.MANUAL),
      },
    };
  },

  /**
   * Soft-delete: marca a conta como deletada preservando auditoria. Se a conta
   * havia gerado uma entrada de caixa ao ser recebida manualmente (origem
   * CONTA_RECEBIDA), reverte também a movimentação para não deixar saldo
   * fantasma. NÃO toca em movimentação de extrato (IMPORTACAO) vinculada por
   * reconciliação — essa reflete dinheiro real do banco.
   */
  async deletar(id: string) {
    const conta = await db.contaReceber.findUnique({
      where: { id },
      include: { movimentacao: true },
    });
    if (!conta) throw new Error("conta a receber não encontrada");

    const movSintetica =
      conta.movimentacao?.origem === OrigemMovimentacao.CONTA_RECEBIDA
        ? conta.movimentacao
        : null;

    return db.$transaction(async (tx) => {
      if (movSintetica) {
        await tx.movimentacao.update({
          where: { id: movSintetica.id },
          data: { deletedAt: new Date() },
        });
      }
      return tx.contaReceber.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  },

  /**
   * Marca uma conta como recebida E lança a ENTRADA no caixa (espelha
   * `marcarComoPaga` das contas a pagar), para o saldo refletir o recebimento
   * sem precisar importar o extrato.
   *
   * Anti dupla-contagem: se JÁ existe uma entrada de extrato ("Amazon",
   * IMPORTACAO) ainda não vinculada e de valor compatível, vincula ELA em vez
   * de criar uma sintética. No caminho inverso (marcar e só depois importar), a
   * reconciliação substitui a sintética pela entrada bancária real.
   */
  async marcarRecebida(id: string) {
    const conta = await db.contaReceber.findUnique({ where: { id } });
    if (!conta) throw new Error("conta a receber não encontrada");
    if (conta.status !== StatusContaReceber.PENDENTE) {
      throw new Error("apenas contas pendentes podem ser marcadas como recebidas");
    }

    const agora = new Date();
    const tolerancia = Math.max(500, Math.round(conta.valor * 0.005));
    const bancaria = await db.movimentacao.findFirst({
      where: {
        tipo: TipoMovimentacao.ENTRADA,
        origem: OrigemMovimentacao.IMPORTACAO,
        descricao: { contains: "Amazon" },
        contaReceber: { is: null },
        deletedAt: null,
        valor: { gte: conta.valor - tolerancia, lte: conta.valor + tolerancia },
      },
      orderBy: { dataCaixa: "desc" },
    });

    if (bancaria) {
      // Vincula a entrada bancária real (sem criar sintética).
      return db.contaReceber.update({
        where: { id },
        data: {
          status: StatusContaReceber.RECEBIDA,
          dataRecebimento: bancaria.dataCaixa,
          movimentacaoId: bancaria.id,
        },
      });
    }

    const categoriaId = await resolverCategoriaReceitaId(conta.origem);
    return db.$transaction(async (tx) => {
      const mov = await tx.movimentacao.create({
        data: {
          tipo: TipoMovimentacao.ENTRADA,
          valor: conta.valor,
          dataCaixa: agora,
          dataCompetencia: agora,
          descricao: conta.descricao,
          categoriaId,
          origem: OrigemMovimentacao.CONTA_RECEBIDA,
          referenciaId: conta.id,
        },
      });
      return tx.contaReceber.update({
        where: { id },
        data: {
          status: StatusContaReceber.RECEBIDA,
          dataRecebimento: agora,
          movimentacaoId: mov.id,
        },
      });
    });
  },
};
