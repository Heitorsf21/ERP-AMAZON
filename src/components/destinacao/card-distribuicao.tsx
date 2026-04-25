"use client";

import * as React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

export type DistribuicaoBolsa = {
  bolsa: string;
  label: string;
  descricao: string;
  cor: string;
  percent: number;
  valor: number;
};

type Props = {
  distribuicao: DistribuicaoBolsa[];
  saldoBase: number;
  somaPercentuais: number;
  configurado: boolean;
};

export function CardDistribuicao({
  distribuicao,
  saldoBase,
  somaPercentuais,
  configurado,
}: Props) {
  const ativas = distribuicao.filter((d) => d.percent > 0);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Distribuição planejada</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Como o saldo projetado de {formatBRL(saldoBase)} seria dividido.
          </p>
        </div>
        {!configurado && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            usando defaults
          </span>
        )}
        {configurado && Math.abs(somaPercentuais - 100) > 0.01 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
            soma = {somaPercentuais.toFixed(0)}%
          </span>
        )}
      </div>

      {ativas.length === 0 || saldoBase === 0 ? (
        <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">
          Sem saldo livre projetado para distribuir.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={ativas}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="valor"
                nameKey="label"
              >
                {ativas.map((entry, idx) => (
                  <Cell key={idx} fill={entry.cor} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatBRL(value),
                  name,
                ]}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--popover-foreground))",
                  fontSize: "12px",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: "11px" }}
                formatter={(value) => (
                  <span className="text-xs text-muted-foreground">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>

          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {ativas.map((d) => (
              <li
                key={d.bolsa}
                className="flex items-center justify-between gap-2 rounded-md border bg-background/40 px-2.5 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full")}
                    style={{ backgroundColor: d.cor }}
                  />
                  <span className="truncate text-xs font-medium">{d.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {d.percent.toFixed(0)}%
                  </span>
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums">
                  {formatBRL(d.valor)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
