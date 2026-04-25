"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/money";
import { useSaldo } from "./card-saldo";

function formatEixoY(centavos: number): string {
  const reais = centavos / 100;
  if (Math.abs(reais) >= 1000) {
    return `R$${(reais / 1000).toFixed(1)}k`;
  }
  return `R$${reais.toFixed(0)}`;
}

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
};

function TooltipPersonalizado({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border bg-background px-3 py-2 text-sm shadow space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {formatBRL(p.value)}
        </p>
      ))}
    </div>
  );
}

export function GraficoProjecao() {
  const { data, isLoading } = useSaldo();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Projeção de caixa
          </CardTitle>
        </CardHeader>
        <CardContent className="flex h-48 items-center justify-center text-muted-foreground text-sm">
          carregando…
        </CardContent>
      </Card>
    );
  }

  const pontos = data?.projecao ?? [];

  const temNegativo = pontos.some((p) => p.saldoCentavos < 0);
  const corTotal = temNegativo ? "#ef4444" : "#22c55e";
  const corTotalFill = temNegativo ? "#fee2e2" : "#dcfce7";
  const corBase = "#3b82f6";

  const chartData = pontos.map((p) => ({
    name: p.label,
    "Com Amazon": p.saldoCentavos,
    "Base s/ Amazon": p.saldoBaseCentavos ?? p.saldoCentavos,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Projeção de caixa</CardTitle>
        <p className="text-xs text-muted-foreground">
          Saldo projetado após contas a pagar e liquidações Amazon previstas
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={corTotal} stopOpacity={0.25} />
                <stop offset="95%" stopColor={corTotalFill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tickFormatter={formatEixoY}
              tick={{ fontSize: 11 }}
              width={64}
              className="text-muted-foreground"
            />
            <Tooltip content={<TooltipPersonalizado />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
            <Area
              type="monotone"
              dataKey="Base s/ Amazon"
              stroke={corBase}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              fill="none"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              type="monotone"
              dataKey="Com Amazon"
              stroke={corTotal}
              strokeWidth={2}
              fill="url(#gradTotal)"
              dot={{ r: 4, fill: corTotal }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
