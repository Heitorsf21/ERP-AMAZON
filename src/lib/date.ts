import { addDays, endOfDay, format, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const TIMEZONE = "America/Sao_Paulo";

/** "Agora" no fuso de SP, retornado como Date em UTC. */
export function agora(): Date {
  return new Date();
}

/** Formata uma data UTC exibindo no fuso de SP (ex: "15/04/2026"). */
export function formatData(date: Date, pattern = "dd/MM/yyyy"): string {
  return format(toZonedTime(date, TIMEZONE), pattern);
}

/** Início do dia no fuso de SP, devolvido como Date UTC. */
export function inicioDoDiaSP(date: Date): Date {
  const zoned = toZonedTime(date, TIMEZONE);
  return fromZonedTime(startOfDay(zoned), TIMEZONE);
}

/** Fim do dia no fuso de SP, devolvido como Date UTC. */
export function fimDoDiaSP(date: Date): Date {
  const zoned = toZonedTime(date, TIMEZONE);
  return fromZonedTime(endOfDay(zoned), TIMEZONE);
}

/** Adiciona N dias no calendário (no fuso de SP). */
export function somarDias(date: Date, dias: number): Date {
  const zoned = toZonedTime(date, TIMEZONE);
  return fromZonedTime(addDays(zoned, dias), TIMEZONE);
}

/**
 * Parse de data em formato BR (dd/MM/yyyy) ou ISO (yyyy-MM-dd).
 * Usado pelo importador CSV/XLSX.
 */
export function parseDataBR(input: string): Date {
  const limpo = input.trim();
  if (!limpo) throw new Error("data vazia");

  const matchBR = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpo);
  if (matchBR) {
    const [, dd, mm, yyyy] = matchBR;
    const iso = `${yyyy}-${mm}-${dd}T00:00:00`;
    return fromZonedTime(iso, TIMEZONE);
  }

  const matchISO = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpo);
  if (matchISO) {
    return fromZonedTime(`${limpo}T00:00:00`, TIMEZONE);
  }

  const fallback = new Date(limpo);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  throw new Error(`data em formato não reconhecido: "${input}"`);
}
