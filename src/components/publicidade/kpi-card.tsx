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

// Card de KPI da Publicidade no padrão visual do Dashboard E-commerce:
// barra lateral de categoria (âmbar = ads) + ícone em pastilha colorida.
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
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      <span
        aria-hidden
        className="absolute bottom-0 left-0 top-0 w-1 bg-amber-500"
      />
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <p className="truncate text-2xl font-bold leading-tight tracking-tight tabular-nums xl:text-3xl">
            {value}
          </p>
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
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}

        <div className="mt-2.5 flex items-center gap-2 text-xs">
          {delta != null && cores ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium",
                  cores.bg,
                  cores.texto,
                )}
              >
                <SetaIcon className="h-3 w-3" />
                {formatPct(delta)}
              </span>
              <span className="text-muted-foreground">vs. período anterior</span>
            </>
          ) : (
            <span className="text-muted-foreground">— sem comparativo</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
