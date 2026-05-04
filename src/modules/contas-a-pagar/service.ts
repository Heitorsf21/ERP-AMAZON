import { addMonths, differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import { documentosFinanceirosService } from "@/modules/documentos-financeiros/service";
import { OrigemMovimentacao, TipoMovimentacao } from "@/modules/shared/domain";
import { contasRepository } from "./repository";
import {
  criarContaSchema,
  filtrosContaSchema,
  pagarContaSchema,
  type CriarContaInput,
} from "./schemas";

type DocumentoExtraido = {
  fornecedor?: string | null;
  cnpj?: string | null;
  valor?: number | null;
  vencimento?: string | null;
  numero?: string | null;
};

type ContaCandidataDocumento = Awaited<
  ReturnType<typeof contasRepository.listarParaDocumento>
>[number];

export type ContaDocumentoSugerida = {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  nfNome: string | null;
  fornecedor: { id: string; nome: string; documento?: string | null };
  categoria: { id: string; nome: string };
  score: number;
  motivos: string[];
};

export type SugestaoContaDocumento = {
  modo: "NOVA" | "EXISTENTE" | "CANDIDATOS";
  candidatos: ContaDocumentoSugerida[];
};

function somenteDigitos(input?: string | null) {
  return (input ?? "").replace(/\D/g, "");
}

function normalizarTexto(input?: string | null) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function palavrasEmComum(a: string, b: string) {
  const stopwords = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "ltda",
    "sa",
    "me",
    "epp",
    "empresa",
    "servicos",
  ]);

  const aa = new Set(
    a
      .split(" ")
      .map((x) => x.trim())
      .filter((x) => x.length >= 3 && !stopwords.has(x)),
  );
  const bb = new Set(
    b
      .split(" ")
      .map((x) => x.trim())
      .filter((x) => x.length >= 3 && !stopwords.has(x)),
  );

  let total = 0;
  for (const palavra of aa) {
    if (bb.has(palavra)) total += 1;
  }
  return total;
}

function parseVencimentoISO(iso?: string | null) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Date(`${iso}T12:00:00.000Z`);
}

function pontuarContaPorDocumento(
  doc: {
    fornecedorNormalizado: string;
    cnpjDigits: string;
    valorCentavos: number | null;
    vencimentoDate: Date | null;
    numeroNormalizado: string;
  },
  conta: ContaCandidataDocumento,
): ContaDocumentoSugerida | null {
  let score = 0;
  const motivos: string[] = [];

  const fornecedorConta = normalizarTexto(conta.fornecedor.nome);
  const cnpjConta = somenteDigitos(conta.fornecedor.documento);
  const descricaoConta = normalizarTexto(conta.descricao);
  const nfNomeConta = normalizarTexto(conta.nfNome);

  if (doc.cnpjDigits && cnpjConta && doc.cnpjDigits === cnpjConta) {
    score += 70;
    motivos.push("CNPJ igual");
  }

  if (doc.fornecedorNormalizado && fornecedorConta) {
    if (doc.fornecedorNormalizado === fornecedorConta) {
      score += 45;
      motivos.push("Fornecedor igual");
    } else if (
      doc.fornecedorNormalizado.includes(fornecedorConta) ||
      fornecedorConta.includes(doc.fornecedorNormalizado)
    ) {
      score += 28;
      motivos.push("Fornecedor muito parecido");
    } else {
      const overlap = palavrasEmComum(doc.fornecedorNormalizado, fornecedorConta);
      if (overlap >= 2) {
        score += 18;
        motivos.push("Fornecedor parcialmente compatível");
      }
    }
  }

  if (typeof doc.valorCentavos === "number") {
    const diff = Math.abs(doc.valorCentavos - conta.valor);
    if (diff === 0) {
      score += 35;
      motivos.push("Valor igual");
    } else if (diff <= 100) {
      score += 18;
      motivos.push("Valor muito próximo");
    } else if (diff <= 500) {
      score += 8;
      motivos.push("Valor próximo");
    }
  }

  if (doc.vencimentoDate) {
    const dias = Math.abs(
      differenceInCalendarDays(doc.vencimentoDate, conta.vencimento),
    );
    if (dias === 0) {
      score += 25;
      motivos.push("Mesmo vencimento");
    } else if (dias <= 3) {
      score += 12;
      motivos.push("Vencimento próximo");
    }
  }

  if (
    doc.numeroNormalizado &&
    (descricaoConta.includes(doc.numeroNormalizado) ||
      nfNomeConta.includes(doc.numeroNormalizado))
  ) {
    score += 15;
    motivos.push("Número do documento compatível");
  }

  if (
    score > 0 &&
    (conta.status === "ABERTA" || conta.status === "VENCIDA")
  ) {
    score += 6;
    motivos.push("Conta ainda em aberto");
  }

  if (score < 20) return null;

  return {
    id: conta.id,
    descricao: conta.descricao,
    valor: conta.valor,
    vencimento: conta.vencimento.toISOString(),
    status: conta.status,
    nfNome: conta.nfNome,
    fornecedor: {
      id: conta.fornecedor.id,
      nome: conta.fornecedor.nome,
      documento: conta.fornecedor.documento,
    },
    categoria: conta.categoria,
    score,
    motivos,
  };
}

export const contasService = {
  async listar(filtros: unknown = {}) {
    const parsed = filtrosContaSchema.parse(filtros);
    // Atualiza status VENCIDA antes de retornar (job leve — single-user local).
    await contasRepository.atualizarVencidas();
    return contasRepository.listar(parsed);
  },

  async totaisDoMes() {
    // Atualiza status VENCIDA antes de calcular totais.
    await contasRepository.atualizarVencidas();

    const agora = new Date();
    // Início do mês corrente em America/Sao_Paulo (UTC-3).
    const ano = agora.getFullYear();
    const mes = agora.getMonth();
    const inicioMes = new Date(Date.UTC(ano, mes, 1, 3, 0, 0));
    const fimMes = new Date(Date.UTC(ano, mes + 1, 1, 2, 59, 59, 999));

    const [emAberto, vencidas, pagasMes, todasMes] = await Promise.all([
      // Em aberto: status ABERTA com vencimento dentro do mês.
      db.contaPagar.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: {
          status: "ABERTA",
          vencimento: { gte: inicioMes, lte: fimMes },
        },
      }),
      // Vencidas: status VENCIDA com vencimento dentro do mês.
      db.contaPagar.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: {
          status: "VENCIDA",
          vencimento: { gte: inicioMes, lte: fimMes },
        },
      }),
      // Pagas no mês: status PAGA com pagoEm dentro do mês.
      db.contaPagar.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: {
          status: "PAGA",
          pagoEm: { gte: inicioMes, lte: fimMes },
        },
      }),
      // Total do mês: todas com vencimento no mês (qualquer status exceto cancelada).
      db.contaPagar.aggregate({
        _sum: { valor: true },
        _count: { _all: true },
        where: {
          status: { not: "CANCELADA" },
          vencimento: { gte: inicioMes, lte: fimMes },
        },
      }),
    ]);

    return {
      emAbertoCentavos: emAberto._sum.valor ?? 0,
      qtdEmAberto: emAberto._count._all,
      vencidasCentavos: vencidas._sum.valor ?? 0,
      qtdVencidas: vencidas._count._all,
      pagasMesCentavos: pagasMes._sum.valor ?? 0,
      qtdPagasMes: pagasMes._count._all,
      totalMesCentavos: todasMes._sum.valor ?? 0,
      qtdTotal: todasMes._count._all,
    };
  },

  async buscarPorId(id: string) {
    const conta = await contasRepository.buscarPorId(id);
    if (!conta) throw new Error("conta não encontrada");
    return conta;
  },

  async criar(input: unknown) {
    const data: CriarContaInput = criarContaSchema.parse(input);

    if (data.dossieId) {
      const dossie = await db.dossieFinanceiro.findUnique({
        where: { id: data.dossieId },
        select: { id: true, contaPagarId: true },
      });
      if (!dossie) throw new Error("dossie financeiro nao encontrado");
      if (dossie.contaPagarId) {
        throw new Error("dossie financeiro ja vinculado a outra conta");
      }
    }

    const fornecedor = await contasRepository.upsertFornecedor(
      data.fornecedorNome,
      data.fornecedorDocumento,
    );

    const conta = await contasRepository.criar({
      fornecedorId: fornecedor.id,
      categoriaId: data.categoriaId,
      descricao: data.descricao,
      valor: data.valorCentavos,
      vencimento: new Date(data.vencimento + "T12:00:00.000Z"),
      recorrencia: data.recorrencia,
      observacoes: data.observacoes,
      nfAnexo: data.nfAnexo,
      nfNome: data.nfNome,
    });

    if (data.dossieId) {
      await documentosFinanceirosService.vincularDossieAConta(
        data.dossieId,
        conta.id,
      );
    } else {
      await documentosFinanceirosService.vincularMelhorDossieAConta(conta.id);
    }

    return contasRepository.buscarPorId(conta.id);
  },

  async sugerirPorDocumento(input: DocumentoExtraido): Promise<SugestaoContaDocumento> {
    const fornecedorNormalizado = normalizarTexto(input.fornecedor);
    const cnpjDigits = somenteDigitos(input.cnpj);
    const valorCentavos =
      typeof input.valor === "number" && Number.isFinite(input.valor) && input.valor > 0
        ? Math.round(input.valor * 100)
        : null;
    const vencimentoDate = parseVencimentoISO(input.vencimento);
    const numeroNormalizado = normalizarTexto(input.numero);

    if (
      !fornecedorNormalizado &&
      !cnpjDigits &&
      valorCentavos === null &&
      !vencimentoDate
    ) {
      return { modo: "NOVA", candidatos: [] };
    }

    await contasRepository.atualizarVencidas();
    const contas = await contasRepository.listarParaDocumento();
    const candidatos = contas
      .map((conta) =>
        pontuarContaPorDocumento(
          {
            fornecedorNormalizado,
            cnpjDigits,
            valorCentavos,
            vencimentoDate,
            numeroNormalizado,
          },
          conta,
        ),
      )
      .filter((c): c is ContaDocumentoSugerida => c !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (candidatos.length === 0) {
      return { modo: "NOVA", candidatos: [] };
    }

    if (candidatos[0]!.score >= 85) {
      return { modo: "EXISTENTE", candidatos };
    }

    return { modo: "CANDIDATOS", candidatos };
  },

  async anexarDocumento(
    contaId: string,
    input: { nfAnexo?: string | null; nfNome?: string | null },
  ) {
    const conta = await contasRepository.buscarPorId(contaId);
    if (!conta) throw new Error("conta não encontrada");

    const nfAnexo = input.nfAnexo?.trim();
    const nfNome = input.nfNome?.trim();
    if (!nfAnexo || !nfNome) {
      throw new Error("anexo da NF/boleto é obrigatório");
    }

    return contasRepository.atualizar(contaId, {
      nfAnexo,
      nfNome,
    });
  },

  async marcarComoPaga(contaId: string, inputRaw: unknown) {
    const { pagoEm: pagoEmStr } = pagarContaSchema.parse(inputRaw);

    const conta = await contasRepository.buscarPorId(contaId);
    if (!conta) throw new Error("conta não encontrada");
    if (conta.status === "PAGA") throw new Error("conta já está paga");
    if (conta.status === "CANCELADA") throw new Error("conta cancelada — não pode ser paga");

    const pagoEmDate = new Date(pagoEmStr + "T12:00:00.000Z");

    return db.$transaction(async (tx) => {
      // 1. Cria movimentação de saída
      const mov = await tx.movimentacao.create({
        data: {
          tipo: TipoMovimentacao.SAIDA,
          valor: conta.valor,
          dataCaixa: pagoEmDate,
          dataCompetencia: pagoEmDate,
          descricao: `${conta.fornecedor.nome} — ${conta.descricao}`,
          categoriaId: conta.categoriaId,
          origem: OrigemMovimentacao.CONTA_PAGA,
          referenciaId: conta.id,
        },
      });

      // 2. Atualiza conta como paga
      const contaAtualizada = await tx.contaPagar.update({
        where: { id: contaId },
        data: { status: "PAGA", pagoEm: pagoEmDate, movimentacaoId: mov.id },
      });

      // 3. Se mensal: gera próxima instância
      if (conta.recorrencia === "MENSAL") {
        await tx.contaPagar.create({
          data: {
            fornecedorId: conta.fornecedorId,
            categoriaId: conta.categoriaId,
            descricao: conta.descricao,
            valor: conta.valor,
            vencimento: addMonths(conta.vencimento, 1),
            recorrencia: "MENSAL",
            contaPaiId: conta.id,
            observacoes: conta.observacoes,
          },
        });
      }

      return contaAtualizada;
    });
  },

  async cancelar(contaId: string) {
    const conta = await contasRepository.buscarPorId(contaId);
    if (!conta) throw new Error("conta não encontrada");
    if (conta.status === "PAGA") throw new Error("conta já paga — não pode ser cancelada");
    return contasRepository.atualizar(contaId, { status: "CANCELADA" });
  },

  async reverterPagamento(contaId: string) {
    const conta = await contasRepository.buscarPorId(contaId);
    if (!conta) throw new Error("conta não encontrada");
    if (conta.status !== "PAGA") throw new Error("conta não está paga");

    const agora = new Date();
    const novoStatus = conta.vencimento < agora ? "VENCIDA" : "ABERTA";

    return db.$transaction(async (tx) => {
      if (conta.movimentacaoId) {
        await tx.movimentacao.delete({ where: { id: conta.movimentacaoId } });
      }
      return tx.contaPagar.update({
        where: { id: contaId },
        data: { status: novoStatus, pagoEm: null, movimentacaoId: null },
      });
    });
  },

  async deletar(contaId: string) {
    const conta = await contasRepository.buscarPorId(contaId);
    if (!conta) throw new Error("conta não encontrada");

    return db.$transaction(async (tx) => {
      if (conta.status === "PAGA" && conta.movimentacaoId) {
        await tx.movimentacao.delete({ where: { id: conta.movimentacaoId } });
      }
      await tx.contaPagar.update({
        where: { id: contaId },
        data: { deletedAt: new Date() },
      });
    });
  },
};
