// Lógica PURA de recorrência de contas fixas. Sem acesso a DB — fácil de testar.
//
// Regras de negócio:
// - Recorrência mensal por dia do mês (`diaVencimento`, 1..31).
// - Se o dia não existir no mês (ex: 31 em fevereiro), usa o último dia do mês.
// - Datas de vencimento são fixadas ao MEIO-DIA UTC, o que mantém o mesmo
//   dia-calendário no fuso de São Paulo (UTC-3) e evita deslocamentos —
//   convenção já usada nas demais datas financeiras do projeto.
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/date";

/** Competência (YYYY-MM) de uma data, no fuso de São Paulo. */
export function competenciaDeData(date: Date): string {
  return format(toZonedTime(date, TIMEZONE), "yyyy-MM");
}

/** Último dia (28/29/30/31) do mês informado. `mes` é 1..12. */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  // O "dia 0" do mês seguinte equivale ao último dia do mês atual.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Dia de vencimento efetivo no mês, com clamp ao último dia existente. */
export function diaVencimentoEfetivo(
  ano: number,
  mes: number,
  dia: number,
): number {
  const ultimo = ultimoDiaDoMes(ano, mes);
  const d = Math.trunc(dia);
  if (d < 1) return 1;
  return Math.min(d, ultimo);
}

/**
 * Data de vencimento (meio-dia UTC) da competência YYYY-MM com o dia informado,
 * já aplicando o clamp ao último dia do mês.
 */
export function vencimentoDaCompetencia(competencia: string, dia: number): Date {
  const [ano, mes] = competencia.split("-").map(Number);
  const diaEfetivo = diaVencimentoEfetivo(ano!, mes!, dia);
  const mm = String(mes).padStart(2, "0");
  const dd = String(diaEfetivo).padStart(2, "0");
  return new Date(`${ano}-${mm}-${dd}T12:00:00.000Z`);
}

/**
 * Extrai a competência (YYYY-MM) e o dia de uma data ISO `yyyy-MM-dd`.
 * Usado para contas fixas NÃO recorrentes, onde o usuário escolhe a data
 * completa da ocorrência única.
 */
export function competenciaEDiaDeDataIso(dataIso: string): {
  competencia: string;
  dia: number;
} {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return { competencia: `${ano}-${String(mes).padStart(2, "0")}`, dia: dia! };
}

/** Competências (YYYY-MM) cujo vencimento (com o `dia`) cai dentro de [de, ate]. */
export function competenciasNoIntervalo(
  de: Date,
  ate: Date,
  dia: number,
): string[] {
  const [anoDe, mesDe] = competenciaDeData(de).split("-").map(Number);
  const [anoAte, mesAte] = competenciaDeData(ate).split("-").map(Number);

  const out: string[] = [];
  let ano = anoDe!;
  let mes = mesDe!;
  // Itera mês a mês do início ao fim do intervalo (inclusive).
  while (ano < anoAte! || (ano === anoAte && mes <= mesAte!)) {
    const competencia = `${ano}-${String(mes).padStart(2, "0")}`;
    const venc = vencimentoDaCompetencia(competencia, dia);
    if (venc.getTime() >= de.getTime() && venc.getTime() <= ate.getTime()) {
      out.push(competencia);
    }
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return out;
}

export type ContaFixaParaPlanejar = {
  id: string;
  valorCentavos: number;
  diaVencimento: number;
  recorrente: boolean;
  /** Para conta NÃO recorrente: a competência única (default = mês de criação). */
  competenciaUnica?: string | null;
};

export type OcorrenciaPlanejada = {
  contaFixaId: string;
  competencia: string;
  vencimento: Date;
  valorCentavos: number;
};

function chaveOcorrencia(contaFixaId: string, competencia: string): string {
  return `${contaFixaId}:${competencia}`;
}

function competenciasNaoRecorrente(
  conta: ContaFixaParaPlanejar,
  de: Date,
  ate: Date,
): string[] {
  const comp = conta.competenciaUnica;
  if (!comp) return [];
  const venc = vencimentoDaCompetencia(comp, conta.diaVencimento);
  return venc.getTime() >= de.getTime() && venc.getTime() <= ate.getTime()
    ? [comp]
    : [];
}

/**
 * Planeja as ocorrências de contas fixas dentro de [de, ate], de forma
 * IDEMPOTENTE: ocorrências cuja chave (`contaFixaId:competencia`) já está em
 * `jaExistentes` são puladas. Não acessa o banco.
 */
export function planejarOcorrencias(
  contas: ContaFixaParaPlanejar[],
  de: Date,
  ate: Date,
  jaExistentes: ReadonlySet<string> = new Set(),
): OcorrenciaPlanejada[] {
  const out: OcorrenciaPlanejada[] = [];
  for (const conta of contas) {
    const competencias = conta.recorrente
      ? competenciasNoIntervalo(de, ate, conta.diaVencimento)
      : competenciasNaoRecorrente(conta, de, ate);
    for (const competencia of competencias) {
      if (jaExistentes.has(chaveOcorrencia(conta.id, competencia))) continue;
      out.push({
        contaFixaId: conta.id,
        competencia,
        vencimento: vencimentoDaCompetencia(competencia, conta.diaVencimento),
        valorCentavos: conta.valorCentavos,
      });
    }
  }
  return out;
}

/**
 * Uma ocorrência "passada" (competência anterior ao mês atual) deve ser
 * materializada já PAGA — o usuário usa o serviço desde sempre, então meses
 * anteriores já foram quitados. O mês atual permanece em aberto para
 * confirmação manual. Compara competências "YYYY-MM" lexicograficamente
 * (equivale à ordem cronológica).
 */
export function ocorrenciaDeveVirPaga(
  competencia: string,
  competenciaAtual: string,
): boolean {
  return competencia < competenciaAtual;
}

/** Soma o valor (centavos) de uma lista de ocorrências planejadas. */
export function totalOcorrenciasCentavos(
  ocorrencias: OcorrenciaPlanejada[],
): number {
  return ocorrencias.reduce((soma, o) => soma + o.valorCentavos, 0);
}

/**
 * MPA pós contas fixas (em %): `(lucroPosAds - contasFixas) / faturamento * 100`.
 * Mantém a mesma semântica do helper `percentual` do dashboard: retorna `null`
 * (exibido como N/A) quando o lucro é desconhecido ou o faturamento é <= 0.
 */
export function calcularMpaPosContasFixas(args: {
  lucroPosAdsCentavos: number | null;
  contasFixasCentavos: number;
  faturamentoCentavos: number;
}): number | null {
  const { lucroPosAdsCentavos, contasFixasCentavos, faturamentoCentavos } = args;
  if (lucroPosAdsCentavos == null) return null;
  if (!faturamentoCentavos || faturamentoCentavos <= 0) return null;
  return ((lucroPosAdsCentavos - contasFixasCentavos) / faturamentoCentavos) * 100;
}
