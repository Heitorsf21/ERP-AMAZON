import { db } from "@/lib/db";
import { somarDias } from "@/lib/date";
import {
  OrigemContaReceber,
  StatusContaReceber,
} from "@/modules/shared/domain";
import {
  parseAmazonCSV,
  resumirImportacao,
  type ResumoImportacao,
} from "./amazon-parser";

// Ciclo médio observado nos relatórios: ~14 dias do pedido até transferência.
const CICLO_LIQUIDACAO_DIAS = 14;

export const contasReceberService = {
  /**
   * Importa o CSV Amazon Unified Transaction e cria/atualiza ContaReceber
   * para cada liquidação com pedidos diferidos (pendentes de transferência).
   *
   * Retorna o resumo da importação para o frontend exibir.
   */
  async importarAmazonCSV(conteudo: string): Promise<ResumoImportacao> {
    const transacoes = parseAmazonCSV(conteudo);
    if (transacoes.length === 0) {
      throw new Error("Nenhuma transação encontrada no CSV");
    }

    const resumo = resumirImportacao(transacoes);

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
    const where = filtroStatus ? { status: filtroStatus } : {};
    return db.contaReceber.findMany({
      where,
      orderBy: { dataPrevisao: "asc" },
    });
  },

  /** Retorna totais agregados por status (PENDENTE + RECEBIDA). */
  async totais() {
    const [pendentes, recebidas] = await Promise.all([
      db.contaReceber.findMany({
        where: { status: StatusContaReceber.PENDENTE },
        select: { valor: true },
      }),
      db.contaReceber.findMany({
        where: { status: StatusContaReceber.RECEBIDA },
        select: { valor: true },
      }),
    ]);

    const totalPendenteCentavos = pendentes.reduce((s, c) => s + c.valor, 0);
    const totalRecebidaCentavos = recebidas.reduce((s, c) => s + c.valor, 0);

    return {
      totalPendenteCentavos,
      quantidadePendente: pendentes.length,
      totalRecebidaCentavos,
      quantidadeRecebida: recebidas.length,
      totalCentavos: totalPendenteCentavos + totalRecebidaCentavos,
    };
  },

  /** Marca uma conta como recebida manualmente. */
  async marcarRecebida(id: string) {
    const conta = await db.contaReceber.findUnique({ where: { id } });
    if (!conta) throw new Error("conta a receber não encontrada");
    if (conta.status !== StatusContaReceber.PENDENTE) {
      throw new Error("apenas contas pendentes podem ser marcadas como recebidas");
    }

    return db.contaReceber.update({
      where: { id },
      data: {
        status: StatusContaReceber.RECEBIDA,
        dataRecebimento: new Date(),
      },
    });
  },
};
