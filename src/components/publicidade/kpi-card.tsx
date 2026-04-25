"use client";

import * as React from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DeltaPolaridade =
  | "padrao" // ↓ verde, ↑ vermelho (custos, ACoS)
  | "invertida" // ↑ verde, ↓ vermelho (vendas, ROAS)
  | "neutra"; // sem coloração

type KpiCardProps = {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  delta?: number | null;
  polaridade?: DeltaPolaridade;
  destaqueClasse?: string;
  destaqueLabel?: string;
};

function formatPct(v: number): string {
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${v.toFixed(1)}%`;
}

function corDelta(
  delta: number,
  polaridade: DeltaPolaridade,
): { texto: string; bg: string } {
  if (polaridade === "neutra")
    return {
      texto: "text-muted-foreground",
      bg: "bg-muted",
    };
  // Considera variações |x| < 0.5% como neutras
  if (Math.abs(delta) < 0.5)
    return { texto: "text-muted-foreground", bg: "bg-muted" };
  const positivo = delta > 0;
  const bom =
    polaridade === "invertida" ? positivo : !positivo;
  if (bom) {
    return {
      texto: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-100 dark:bg-emerald-950/40",
    };
  }
  return {
    texto: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-950/40",
  };
}

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  delta,
  polaridade = "padrao",
  destaqueClasse,
  destaqueLabel,
}: KpiCardProps) {
  const SetaIcon =
    delta == null
      ? Minus
      : delta > 0
        ? TrendingUp
        : delta < 0
          ? TrendingDown
          : Minus;

  const cores = delta == null ? null : corDelta(delta, polaridade);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 truncate text-2xl font-semibold tabular-nums">
              {value}
            </p>
            {sub && (
              <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>

        <div className="mt-3 flex items-center gap-2">
          {delta != null && cores ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                cores.bg,
                cores.texto,
              )}
            >
              <SetaIcon className="h-3 w-3" />
              {formatPct(delta)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              <Minus className="h-3 w-3" />
              vs. anterior
            </span>
          )}
          {destaqueLabel && (
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
                destaqueClasse,
              )}
            >
              {destaqueLabel}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
