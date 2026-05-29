import { inicioDoDiaSP } from "@/lib/date";
import { logger } from "@/lib/logger";
import {
  atualizarContaFixaSchema,
  criarContaFixaSchema,
} from "./schemas";
import { contasFixasRepository } from "./repository";
import {
  competenciaDeData,
  competenciaEDiaDeDataIso,
  planejarOcorrencias,
  totalOcorrenciasCentavos,
  vencimentoDaCompetencia,
  type ContaFixaParaPlanejar,
} from "./recorrencia";

const log = logger.child({ modulo: "contas-fixas/service" });

// Segurança/robustez: a geração de ocorrências dispara em GET (agenda/dashboard).
// Limitamos a janela materializável para impedir que um intervalo enorme
// (ex: range manipulado na query) materialize milhares de ContaPagar (DoS).
const MAX_DIAS_GERACAO = 400;

function limitarIntervalo(de: Date, ate: Date): { de: Date; ate: Date } {
  if (ate.getTime() < de.getTime()) return { de, ate: de };
  const maxAte = new Date(de.getTime() + MAX_DIAS_GERACAO * 24 * 60 * 60 * 1000);
  return { de, ate: ate.getTime() > maxAte.getTime() ? maxAte : ate };
}

type ContaFixaMaterializavel = Awaited<
  ReturnType<typeof contasFixasRepository.listarAtivasParaMaterializar>
>[number];

function paraPlanejar(
  contas: ContaFixaMaterializavel[],
): Array<ContaFixaParaPlanejar & { _ref: ContaFixaMaterializavel }> {
  return contas.map((c) => ({
    id: c.id,
    valorCentavos: c.valor,
    diaVencimento: c.diaVencimento,
    recorrente: c.recorrente,
    // Conta NÃO recorrente: usa a competência escolhida pelo usuário
    // (fallback para o mês de criação em registros antigos sem o campo).
    competenciaUnica: c.recorrente
      ? null
      : (c.competenciaUnica ?? competenciaDeData(c.createdAt)),
    _ref: c,
  }));
}

export const contasFixasService = {
  listar(incluirInativas = false) {
    return contasFixasRepository.listar(incluirInativas);
  },

  async buscarPorId(id: string) {
    const conta = await contasFixasRepository.buscarPorId(id);
    if (!conta) throw new Error("conta fixa não encontrada");
    return conta;
  },

  async criar(input: unknown) {
    const data = criarContaFixaSchema.parse(input);
    // NÃO recorrente com data escolhida → deriva dia + competência única.
    let diaVencimento = data.diaVencimento;
    let competenciaUnica: string | null = null;
    if (!data.recorrente && data.vencimentoUnico) {
      const r = competenciaEDiaDeDataIso(data.vencimentoUnico);
      diaVencimento = r.dia;
      competenciaUnica = r.competencia;
    }
    return contasFixasRepository.criar({
      descricao: data.descricao,
      valor: data.valorCentavos,
      diaVencimento,
      recorrente: data.recorrente,
      competenciaUnica,
      ativa: data.ativa,
      categoriaId: data.categoriaId ?? null,
      fornecedorId: data.fornecedorId ?? null,
      observacoes: data.observacoes ?? null,
    });
  },

  async atualizar(id: string, input: unknown) {
    const data = atualizarContaFixaSchema.parse(input);
    const atual = await this.buscarPorId(id); // 404 se não existir

    // Recalcula recorrência/dia/competência a partir do estado efetivo.
    const recorrente = data.recorrente ?? atual.recorrente;
    let diaVencimento = data.diaVencimento ?? atual.diaVencimento;
    let competenciaUnica: string | null = atual.competenciaUnica;
    if (recorrente) {
      competenciaUnica = null; // recorrente não usa competência única
    } else if (data.vencimentoUnico) {
      const r = competenciaEDiaDeDataIso(data.vencimentoUnico);
      diaVencimento = r.dia;
      competenciaUnica = r.competencia;
    }

    const atualizada = await contasFixasRepository.atualizar(id, {
      ...(data.descricao != null ? { descricao: data.descricao } : {}),
      ...(data.valorCentavos != null ? { valor: data.valorCentavos } : {}),
      diaVencimento,
      recorrente,
      competenciaUnica,
      ...(data.ativa != null ? { ativa: data.ativa } : {}),
      ...(data.categoriaId !== undefined
        ? { categoriaId: data.categoriaId ?? null }
        : {}),
      ...(data.fornecedorId !== undefined
        ? { fornecedorId: data.fornecedorId ?? null }
        : {}),
      ...(data.observacoes !== undefined
        ? { observacoes: data.observacoes ?? null }
        : {}),
    });

    // Opcional (escolha do usuário): propaga as mudanças às ocorrências
    // FUTURAS ainda em aberto. Nunca toca em ocorrências pagas.
    if (data.sincronizarFuturas) {
      await this.sincronizarOcorrenciasFuturas(id);
    }

    return atualizada;
  },

  /**
   * Reconcilia as ocorrências FUTURAS em aberto (vencimento >= hoje, status
   * ABERTA/VENCIDA) com a definição atual da conta fixa:
   *  - competência ainda planejada → atualiza valor/vencimento/descrição;
   *  - competência não mais planejada (conta inativa, não recorrente movida) →
   *    soft-delete (libera o índice único e preserva auditoria).
   * Ocorrências PAGAS nunca são alteradas.
   */
  async sincronizarOcorrenciasFuturas(id: string) {
    const conta = await contasFixasRepository.buscarRaw(id);
    if (!conta) return { atualizadas: 0, removidas: 0 };

    const corte = inicioDoDiaSP(new Date());
    const janelaAte = new Date(
      corte.getTime() + MAX_DIAS_GERACAO * 24 * 60 * 60 * 1000,
    );
    const ativa = conta.ativa && !conta.deletedAt;
    const planejadas = ativa
      ? planejarOcorrencias(
          [
            {
              id: conta.id,
              valorCentavos: conta.valor,
              diaVencimento: conta.diaVencimento,
              recorrente: conta.recorrente,
              competenciaUnica: conta.recorrente
                ? null
                : (conta.competenciaUnica ?? competenciaDeData(conta.createdAt)),
            },
          ],
          corte,
          janelaAte,
        )
      : [];
    const setPlanejadas = new Set(planejadas.map((o) => o.competencia));

    const futuras = await contasFixasRepository.listarOcorrenciasFuturasEmAberto(
      id,
      corte,
    );

    let atualizadas = 0;
    let removidas = 0;
    for (const occ of futuras) {
      if (occ.competencia && setPlanejadas.has(occ.competencia)) {
        await contasFixasRepository.atualizarOcorrencia(occ.id, {
          valor: conta.valor,
          vencimento: vencimentoDaCompetencia(occ.competencia, conta.diaVencimento),
          descricao: conta.descricao,
        });
        atualizadas += 1;
      } else {
        await contasFixasRepository.removerOcorrencia(occ.id);
        removidas += 1;
      }
    }
    return { atualizadas, removidas };
  },

  async desativar(id: string) {
    await this.buscarPorId(id);
    return contasFixasRepository.softDelete(id);
  },

  /**
   * Materializa, de forma IDEMPOTENTE, as ocorrências (ContaPagar) das contas
   * fixas ativas dentro de [de, ate]. Nunca duplica: confia no set de
   * existentes + no índice único (contaFixaId, competencia) como rede final.
   * Nunca sobrescreve ocorrências já pagas/canceladas.
   */
  async garantirOcorrencias(intervalo: { de: Date; ate: Date }) {
    const { de, ate } = limitarIntervalo(intervalo.de, intervalo.ate);
    const contas = await contasFixasRepository.listarAtivasParaMaterializar();
    if (contas.length === 0) return { criadas: 0 };

    const planejaveis = paraPlanejar(contas);
    const mapaRef = new Map(planejaveis.map((p) => [p.id, p._ref]));

    const existentes = await contasFixasRepository.ocorrenciasMaterializadas(
      contas.map((c) => c.id),
    );
    const setExistentes = new Set(
      existentes.map((e) => `${e.contaFixaId}:${e.competencia}`),
    );

    const planejadas = planejarOcorrencias(planejaveis, de, ate, setExistentes);
    if (planejadas.length === 0) return { criadas: 0 };

    // Resolve sentinelas só quando há alguma conta sem categoria/fornecedor.
    const precisaSentinela = planejadas.some((o) => {
      const ref = mapaRef.get(o.contaFixaId);
      return !ref?.categoriaId || !ref?.fornecedorId;
    });
    const [categoriaPadrao, fornecedorPadrao] = precisaSentinela
      ? await Promise.all([
          contasFixasRepository.categoriaPadrao(),
          contasFixasRepository.fornecedorPadrao(),
        ])
      : [null, null];

    let criadas = 0;
    for (const occ of planejadas) {
      const ref = mapaRef.get(occ.contaFixaId);
      if (!ref) continue;
      try {
        await contasFixasRepository.criarOcorrencia({
          fornecedorId: ref.fornecedorId ?? fornecedorPadrao!.id,
          categoriaId: ref.categoriaId ?? categoriaPadrao!.id,
          descricao: ref.descricao,
          valor: occ.valorCentavos,
          vencimento: occ.vencimento,
          contaFixaId: occ.contaFixaId,
          competencia: occ.competencia,
          observacoes: ref.observacoes,
        });
        criadas += 1;
      } catch (err) {
        // P2002 (unique) = corrida com outra geração concorrente: ignora.
        const code = (err as { code?: string })?.code;
        if (code === "P2002") continue;
        log.warn(
          { err, contaFixaId: occ.contaFixaId, competencia: occ.competencia },
          "falha ao materializar ocorrência de conta fixa",
        );
      }
    }
    return { criadas };
  },

  /**
   * Total (centavos) das contas fixas ATIVAS com vencimento dentro de [de, ate].
   * Cálculo baseado nas definições (não escreve no banco) — usado no indicador
   * "MPA pós contas fixas" do dashboard. Considera contas ativas (planejamento);
   * contas inativas/excluídas ficam de fora.
   */
  async totalDoPeriodo(intervalo: { de: Date; ate: Date }) {
    const { de, ate } = limitarIntervalo(intervalo.de, intervalo.ate);
    const contas = await contasFixasRepository.listarAtivasParaMaterializar();
    const ocorrencias = planejarOcorrencias(paraPlanejar(contas), de, ate);
    return {
      totalCentavos: totalOcorrenciasCentavos(ocorrencias),
      ocorrencias: ocorrencias.length,
    };
  },
};
