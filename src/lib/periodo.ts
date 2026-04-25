import {
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/date";

export const PeriodoPreset = {
  HOJE: "hoje",
  ONTEM: "ontem",
  SETE_DIAS: "7d",
  QUINZE_DIAS: "15d",
  TRINTA_DIAS: "30d",
  MES_ATUAL: "mesAtual",
  MES_PASSADO: "mesPassado",
  ANO_ATUAL: "anoAtual",
  PERSONALIZADO: "personalizado",
} as const;

export type PeriodoPreset =
  (typeof PeriodoPreset)[keyof typeof PeriodoPreset];

export type IntervaloPeriodo = {
  de: Date;
  ate: Date;
};

export function resolverPeriodo(
  preset: PeriodoPreset | string = PeriodoPreset.TRINTA_DIAS,
  de?: string | Date | null,
  ate?: string | Date | null,
  base = new Date(),
): IntervaloPeriodo {
  if (preset === PeriodoPreset.PERSONALIZADO) {
    if (!de || !ate) {
      throw new Error("periodo personalizado exige de e ate");
    }

    return {
      de: inicioDoDiaPeriodo(de),
      ate: fimDoDiaPeriodo(ate),
    };
  }

  const hojeZonado = toZonedTime(base, TIMEZONE);

  if (preset === PeriodoPreset.HOJE) {
    return intervaloDeDia(hojeZonado);
  }

  if (preset === PeriodoPreset.ONTEM) {
    return intervaloDeDia(subDays(hojeZonado, 1));
  }

  if (preset === PeriodoPreset.SETE_DIAS) {
    return intervaloEntreDias(subDays(hojeZonado, 6), hojeZonado);
  }

  if (preset === PeriodoPreset.QUINZE_DIAS) {
    return intervaloEntreDias(subDays(hojeZonado, 14), hojeZonado);
  }

  if (preset === PeriodoPreset.MES_ATUAL) {
    return intervaloZonado(startOfMonth(hojeZonado), endOfMonth(hojeZonado));
  }

  if (preset === PeriodoPreset.MES_PASSADO) {
    const mesPassado = subMonths(hojeZonado, 1);
    return intervaloZonado(startOfMonth(mesPassado), endOfMonth(mesPassado));
  }

  if (preset === PeriodoPreset.ANO_ATUAL) {
    return intervaloZonado(startOfYear(hojeZonado), endOfYear(hojeZonado));
  }

  return intervaloEntreDias(subDays(hojeZonado, 29), hojeZonado);
}

export function resolverPeriodoDeBusca(params: URLSearchParams) {
  const de = params.get("de");
  const ate = params.get("ate");

  if (de && ate) {
    return resolverPeriodo(PeriodoPreset.PERSONALIZADO, de, ate);
  }

  return resolverPeriodo(params.get("preset") ?? PeriodoPreset.TRINTA_DIAS);
}

export function formatarDataInputPeriodo(date: Date): string {
  return format(toZonedTime(date, TIMEZONE), "yyyy-MM-dd");
}

export function formatarDiaPeriodo(date: Date): string {
  return format(toZonedTime(date, TIMEZONE), "yyyy-MM-dd");
}

function inicioDoDiaPeriodo(value: string | Date): Date {
  if (value instanceof Date) {
    return fromZonedTime(startOfDay(toZonedTime(value, TIMEZONE)), TIMEZONE);
  }

  return fromZonedTime(`${value}T00:00:00`, TIMEZONE);
}

function fimDoDiaPeriodo(value: string | Date): Date {
  if (value instanceof Date) {
    return fromZonedTime(endOfDay(toZonedTime(value, TIMEZONE)), TIMEZONE);
  }

  return fromZonedTime(`${value}T23:59:59.999`, TIMEZONE);
}

function intervaloDeDia(date: Date): IntervaloPeriodo {
  return intervaloZonado(startOfDay(date), endOfDay(date));
}

function intervaloEntreDias(inicio: Date, fim: Date): IntervaloPeriodo {
  return intervaloZonado(startOfDay(inicio), endOfDay(fim));
}

function intervaloZonado(de: Date, ate: Date): IntervaloPeriodo {
  return {
    de: fromZonedTime(de, TIMEZONE),
    ate: fromZonedTime(ate, TIMEZONE),
  };
}
