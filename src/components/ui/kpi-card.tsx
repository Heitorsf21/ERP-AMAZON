import * as React from "react";
import { cn } from "@/lib/utils";

const colorMap = {
  blue: "text-primary bg-primary/10",
  green: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
  red: "text-destructive bg-destructive/10",
  orange: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
  violet: "text-violet-600 bg-violet-500/10 dark:text-violet-400",
  slate: "text-slate-600 bg-slate-500/10 dark:text-slate-300",
} as const;

export type KpiColor = keyof typeof colorMap;

type Props = {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ComponentType<{ className?: string }>;
  color?: KpiColor;
  highlight?: boolean;
  className?: string;
  valueClassName?: string;
};

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "blue",
  highlight,
  className,
  valueClassName,
}: Props) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        highlight && "ring-1 ring-primary/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground line-clamp-1"
            title={label}
          >
            {label}
          </p>
          <p
            className={cn(
              "mt-1 text-xl font-bold tabular-nums break-words",
              valueClassName,
            )}
            title={value}
          >
            {value}
          </p>
          {sub && (
            <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1" title={sub}>
              {sub}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-lg p-2", colorMap[color])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}
