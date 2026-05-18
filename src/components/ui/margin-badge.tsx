import * as React from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: number | null | undefined;
  className?: string;
};

function format(value: number): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function MarginBadge({ value, className }: Props) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span
        className={cn(
          "inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400",
          className,
        )}
      >
        N/A
      </span>
    );
  }

  const tone =
    value >= 25
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      : value >= 10
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
      {format(value)}
    </span>
  );
}
