import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { fimDoDiaSP, inicioDoDiaSP, somarDias } from "@/lib/date";
import {
  FormatoImportacao,
  OrigemMovimentacao,
  StatusContaReceber,
  TipoMovimentacao,
} from "@/modules/shared/domain";
import { movimentacaoRepository } from "./repository";
import {
  ajusteSaldoSchema,
  filtrosMovimentacaoSchema,
  linhaImportacaoSchema,
  novaMovimentacaoSchema,
  type LinhaImportacao,
} from "./schemas";

type MetadadosImportacao = {
  nomeArquivo: string;
  formato: FormatoImportacao;
};

type PrismaTx = PrismaClient | Prisma.TransactionClient;

export const financeiroService = {
  async listar(filtros: unknown = {}) {
    const parsed = filtrosMovimentacaoSchema.parse(filtros);
    return movimentacaoRepository.listar(parsed);
  },

  async calcularSaldoAtual(filtros: unknown = {}): Promise<number> {
    const parsed = filtrosMovimentacaoSchema.parse(filtros);
    return movimentacaoRepository.somarSaldo(parsed);
  },

  /**
   * Retorna saldo atual, comprometido (contas ABERTA + VENCIDA), livre,
   * recebíveis pendentes e projeção de caixa para 0/7/15/30 dias.
   * A projeção é bidirecional: subtrai saídas (contas a pagar) e soma
   * entradas previstas (contas a receber).
   */
  async calcularSaldoCompleto() {
    const agora = new Date();

    // Garante que contas vencidas estejam com status correto antes de calcular.
    await db.contaPagar.updateMany({
      where: { status: "ABERTA", vencimento: { lt: inicioDoDiaSP(agora) } },
      data: { status: "VENCIDA" },
    });

    const [saldoAtual, contasAbertas] = await Promise.all([
      movimentacaoRepository.somarSaldo(),
      db.contaPagar.findMany({
        where: { status: { in: ["ABERTA", "VENCIDA"] } },
        select: { valor: true, vencimento: true },
      }),
    ]);

    const recebiveis: Array<{ valor: number; dataPrevisao: Date | null }> =
      await db.contaReceber.findMany({
        where: { status: StatusContaReceber.PENDENTE },
        select: { valor: true, dataPrevisao: true },
      });

    const comprometidoCentavos = contasAbertas.reduce(
      (acc: number, c) => acc + c.valor,
      0,
    );

    const aReceberCentavos = recebiveis.reduce(
      (acc: number, c) => acc + c.valor,
      0,
    );

    const projecao = [0, 7, 15, 30].map((dias) => {
      const limite = fimDoDiaSP(somarDias(agora, dias));
      const saidaProjetada = saldoProjetado(saldoAtual, contasAbertas, limite);
      const entradasPrevistas = recebiveis
        .filter((c) => c.dataPrevisao && c.dataPrevisao <= limite)
        .reduce((acc: number, c) => acc + c.valor, 0);

      return {
        label: dias === 0 ? "Hoje" : `+${dias}d`,
        dias,
        saldoCentavos: saidaProjetada + entradasPrevistas,
      };
    });

    return {
      atualCentavos: saldoAtual,
      comprometidoCentavos,
      livreCentavos: saldoAtual - comprometidoCentavos,
      contasEmAberto: contasAbertas.length,
      aReceberCentavos,
      recebiveisCount: recebiveis.length,
      projecao,
    };
  },

  async registrarMovimentacao(input: unknown, tx: PrismaTx = db) {
    const data = novaMovimentacaoSchema.parse(input);
    return movimentacaoRepository.criar(
      {
        tipo: data.tipo,
        valor: data.valorCentavos,
        dataCaixa: data.dataCaixa,
        dataCompetencia: data.dataCompetencia ?? data.dataCaixa,
        descricao: data.descricao,
        origem: OrigemMovimentacao.MANUAL,
        categoria: { connect: { id: data.categoriaId } },
      },
      tx,
    );
  },

  async registrarAjuste(input: unknown, tx: PrismaTx = db) {
    const data = ajusteSaldoSchema.parse(input);
    return movimentacaoRepository.criar(
      {
        tipo: data.tipo,
        valor: data.valorCentavos,
        dataCaixa: data.dataCaixa,
        dataCompetencia: data.dataCaixa,
        descricao: data.descricao,
        origem: OrigemMovimentacao.AJUSTE,
        motivoAjuste: data.motivoAjuste,
        categoria: { connect: { id: data.categoriaId } },
      },
      tx,
    );
  },

  async removerMovimentacao(id: string) {
    const mov = await db.movimentacao.findUnique({ where: { id } });
    if (!mov) throw new Error("movimentação não encontrada");
    // Movimentações geradas por conta paga devem ser revertidas via estorno
    // da conta (F2), não apagadas diretamente. No MVP bloqueamos para evitar
    // inconsistência entre ContaPagar.status e a movimentação vinculada.
    if (mov.origem === OrigemMovimentacao.CONTA_PAGA) {
      throw new Error(
        "movimentação gerada por conta paga — estorne pela tela de contas",
      );
    }
    return movimentacaoRepository.remover(id);
  },

  /**
   * Importa um lote de linhas validadas (provenientes do ImportadorCSV).
   * Cria primeiro o registro de ImportacaoLote (histórico) e vincula as
   * movimentações via referenciaId. Tudo em uma única transação.
   */
  async importarLote(linhas: LinhaImportacao[], meta: MetadadosImportacao) {
    if (linhas.length === 0) return { criadas: 0, loteId: null };

    const resultado = await db.$transaction(async (tx) => {
      const lote = await tx.importacaoLote.create({
        data: {
          nomeArquivo: meta.nomeArquivo,
          formato: meta.formato,
          totalLinhas: linhas.length,
        },
      });

      const dados: Prisma.MovimentacaoCreateManyInput[] = linhas.map((l) => ({
        tipo: l.tipo,
        valor: l.valorCentavos,
        dataCaixa: l.dataCaixa,
        dataCompetencia: l.dataCaixa,
        descricao: l.descricao,
        categoriaId: l.categoriaId,
        origem: OrigemMovimentacao.IMPORTACAO,
        referenciaId: lote.id,
      }));

      const r = await movimentacaoRepository.criarMuitas(dados, tx);
      return { criadas: r.count, loteId: lote.id };
    });

    return resultado;
  },

  /**
   * Lista lotes de importação em ordem decrescente (mais recente primeiro).
   * Não filtra — o histórico é curto e cabe inteiro no diálogo.
   */
  async listarImportacoes() {
    return db.importacaoLote.findMany({
      orderBy: { criadoEm: "desc" },
    });
  },

  /**
   * Remove o lote e todas as movimentações geradas por ele (origem=IMPORTACAO,
   * referenciaId=lote.id). Em transação para não deixar órfãos.
   */
  async removerImportacao(loteId: string) {
    return db.$transaction(async (tx) => {
      const lote = await tx.importacaoLote.findUnique({ where: { id: loteId } });
      if (!lote) throw new Error("lote de importação não encontrado");
      const vinculadasAContas = await tx.movimentacao.count({
        where: {
          origem: OrigemMovimentacao.IMPORTACAO,
          referenciaId: loteId,
          contaPaga: { isNot: null },
        },
      });
      if (vinculadasAContas > 0) {
        throw new Error(
          "esta importação tem pagamentos conciliados com contas a pagar",
        );
      }
      const apagadas = await tx.movimentacao.deleteMany({
        where: {
          origem: OrigemMovimentacao.IMPORTACAO,
          referenciaId: loteId,
        },
      });
      await tx.importacaoLote.delete({ where: { id: loteId } });
      return { removidas: apagadas.count };
    });
  },
};

/**
 * Valida uma linha bruta contra o schema de importação. Exportado para o
 * endpoint de import e para testes.
 */
export function validarLinhaImportacao(bruto: unknown) {
  return linhaImportacaoSchema.safeParse(bruto);
}

/**
 * Helper puro (sem I/O) para calcular saldo a partir de uma lista de
 * movimentações já carregadas. Útil em cálculos derivados e testes.
 */
export function saldoDeMovimentacoes(
  movs: Array<{ tipo: string; valor: number }>,
): number {
  let total = 0;
  for (const m of movs) {
    if (m.tipo === TipoMovimentacao.ENTRADA) total += m.valor;
    else if (m.tipo === TipoMovimentacao.SAIDA) total -= m.valor;
  }
  return total;
}

/**
 * Helper puro para projetar o saldo futuro dado um conjunto de contas abertas.
 * Subtrai do saldo atual apenas as contas cujo vencimento cai até `ate`.
 * Exportado para testes unitários.
 */
export function saldoProjetado(
  saldoAtual: number,
  contas: Array<{ valor: number; vencimento: Date }>,
  ate: Date,
): number {
  const saidas = contas
    .filter((c) => c.vencimento <= ate)
    .reduce((acc, c) => acc + c.valor, 0);
  return saldoAtual - saidas;
}
