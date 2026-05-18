import * as React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: number | null | undefined;
  unit?: "percent" | "pp";
  inverso?: boolean;
  className?: string;
};

export function TrendIndicator({
  value,
  unit = "percent",
  inverso = false,
  className,
}: Props) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.05) {
    return null;
  }
  const isPositive = value > 0;
  const isGood = inverso ? !isPositive : isPositive;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const tone = isGood
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500 dark:text-red-400";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}
      {unit === "pp" ? "pp" : "%"}
    </span>
  );
}
