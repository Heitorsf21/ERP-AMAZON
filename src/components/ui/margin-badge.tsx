import * as React from "react";
import { cn } from "@/lib/utils";

export type MarginBadgeThresholds = {
  /** Mínimo (inclusivo) para classificar como verde. */
  green: number;
  /** Mínimo (inclusivo) para classificar como âmbar. */
  amber: number;
};

const DEFAULT_THRESHOLDS: MarginBadgeThresholds = { green: 25, amber: 10 };

/** Faixa usada pela MPA (Margem Pós-Anúncio) — mais permissiva na verde. */
export const MPA_THRESHOLDS: MarginBadgeThresholds = { green: 20, amber: 10 };

type Props = {
  value: number | null | undefined;
  className?: string;
  thresholds?: MarginBadgeThresholds;
  /** Prefixo opcional, ex: "MPA". Renderizado antes do número. */
  prefix?: string;
};

function format(value: number): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function MarginBadge({
  value,
  className,
  thresholds = DEFAULT_THRESHOLDS,
  prefix,
}: Props) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span
        className={cn(
          "inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400",
          className,
        )}
      >
        {prefix ? `${prefix} N/A` : "N/A"}
      </span>
    );
  }

  const tone =
    value >= thresholds.green
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      : value >= thresholds.amber
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
        : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";

  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      {prefix ? `${prefix} ${format(value)}` : format(value)}
    </span>
  );
}
