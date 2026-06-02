// Lógica PURA de recorrência de tarefas. Sem acesso a DB — fácil de testar.
//
// Espelha o padrão das contas fixas (recorrência → materialização idempotente),
// mas com mais tipos: DIARIA, SEMANAL (dias da semana), MENSAL (dia do mês,
// com clamp ao último dia) e PERSONALIZADA (a cada N dias/semanas).
//
// Convenção de data: cada ocorrência é fixada ao MEIO-DIA UTC. Isso mantém o
// mesmo dia-calendário no fuso de São Paulo (UTC-3) e é a mesma convenção que
// `prazoParaDate` usa para o prazo das tarefas. A chave de idempotência é o
// dia `yyyy-MM-dd` (UTC) da ocorrência — não há duas ocorrências do mesmo molde
// no mesmo dia.

export type TipoRecorrenciaTarefa =
  | "DIARIA"
  | "SEMANAL"
  | "MENSAL"
  | "PERSONALIZADA";

export type TipoTerminoTarefa = "NUNCA" | "DATA" | "N_VEZES";

export type TarefaRecorrenteParaPlanejar = {
  id: string;
  tipoRecorrencia: TipoRecorrenciaTarefa;
  /** Dias da semana (0=domingo … 6=sábado) para SEMANAL. */
  diasSemana?: number[] | null;
  /** Dia do mês (1..31) para MENSAL — clampado ao último dia existente. */
  diaMes?: number | null;
  /** Intervalo: "a cada N" (dias/semanas/meses conforme o tipo). Default 1. */
  intervalo?: number | null;
  /** Unidade do intervalo para PERSONALIZADA. */
  unidadeIntervalo?: "DIAS" | "SEMANAS" | null;
  tipoTermino: TipoTerminoTarefa;
  terminoAte?: Date | null;
  terminoMaxVezes?: number | null;
  /** Data-base da série. */
  inicioEm: Date;
};

export type OcorrenciaPlanejadaTarefa = {
  tarefaRecorrenteId: string;
  /** yyyy-MM-dd (UTC) — chave de idempotência. */
  chaveOcorrencia: string;
  /** Instante da ocorrência, ao meio-dia UTC. */
  dataPlanejada: Date;
};

const DIA_MS = 86_400_000;
// Backstop anti-loop: cobre vários anos de iteração diária.
const MAX_ITERACOES = 4000;

function diaNoonUTC(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      12,
      0,
      0,
      0,
    ),
  );
}

function chaveDe(date: Date): string {
  const ano = date.getUTCFullYear();
  const mes = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(date.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Último dia (28/29/30/31) do mês. `mes` é 1..12. */
function ultimoDiaDoMesUTC(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function ehOcorrencia(
  molde: TarefaRecorrenteParaPlanejar,
  dia: Date,
  inicio: Date,
): boolean {
  const intervalo = Math.max(1, Math.trunc(molde.intervalo ?? 1));
  switch (molde.tipoRecorrencia) {
    case "DIARIA": {
      const dias = Math.round((dia.getTime() - inicio.getTime()) / DIA_MS);
      return dias >= 0 && dias % intervalo === 0;
    }
    case "SEMANAL": {
      const diasSemana = molde.diasSemana ?? [];
      if (!diasSemana.includes(dia.getUTCDay())) return false;
      const inicioWeekStart = inicio.getTime() - inicio.getUTCDay() * DIA_MS;
      const diaWeekStart = dia.getTime() - dia.getUTCDay() * DIA_MS;
      const semanas = Math.round((diaWeekStart - inicioWeekStart) / (7 * DIA_MS));
      return semanas >= 0 && semanas % intervalo === 0;
    }
    case "MENSAL": {
      const diaMes = molde.diaMes ?? inicio.getUTCDate();
      const efetivo = Math.min(
        diaMes,
        ultimoDiaDoMesUTC(dia.getUTCFullYear(), dia.getUTCMonth() + 1),
      );
      if (dia.getUTCDate() !== efetivo) return false;
      const meses =
        (dia.getUTCFullYear() - inicio.getUTCFullYear()) * 12 +
        (dia.getUTCMonth() - inicio.getUTCMonth());
      return meses >= 0 && meses % intervalo === 0;
    }
    case "PERSONALIZADA": {
      const passoDias = intervalo * (molde.unidadeIntervalo === "SEMANAS" ? 7 : 1);
      const dias = Math.round((dia.getTime() - inicio.getTime()) / DIA_MS);
      return dias >= 0 && dias % passoDias === 0;
    }
    default:
      return false;
  }
}

/**
 * Planeja as ocorrências de uma tarefa recorrente dentro de [de, ate], de forma
 * IDEMPOTENTE: ocorrências cuja chave (`yyyy-MM-dd`) já está em `jaExistentes`
 * são puladas. Respeita o término (NUNCA / DATA / N_VEZES). Não acessa o banco.
 *
 * A contagem para N_VEZES é feita desde `inicioEm` (não desde `de`), garantindo
 * que o limite total de ocorrências seja respeitado independentemente da janela.
 */
export function planejarOcorrenciasTarefas(
  molde: TarefaRecorrenteParaPlanejar,
  de: Date,
  ate: Date,
  jaExistentes: ReadonlySet<string> = new Set(),
): OcorrenciaPlanejadaTarefa[] {
  const inicio = diaNoonUTC(molde.inicioEm);
  const terminoAte = molde.terminoAte ? diaNoonUTC(molde.terminoAte) : null;
  const out: OcorrenciaPlanejadaTarefa[] = [];

  let cursor = inicio;
  let ocorrencias = 0;
  let iteracoes = 0;

  while (cursor.getTime() <= ate.getTime() && iteracoes < MAX_ITERACOES) {
    iteracoes++;
    if (terminoAte && cursor.getTime() > terminoAte.getTime()) break;

    if (ehOcorrencia(molde, cursor, inicio)) {
      ocorrencias++;
      if (
        molde.tipoTermino === "N_VEZES" &&
        molde.terminoMaxVezes != null &&
        ocorrencias > molde.terminoMaxVezes
      ) {
        break;
      }
      if (cursor.getTime() >= de.getTime()) {
        const chave = chaveDe(cursor);
        if (!jaExistentes.has(chave)) {
          out.push({
            tarefaRecorrenteId: molde.id,
            chaveOcorrencia: chave,
            dataPlanejada: new Date(cursor),
          });
        }
      }
    }

    cursor = new Date(cursor.getTime() + DIA_MS);
  }

  return out;
}
