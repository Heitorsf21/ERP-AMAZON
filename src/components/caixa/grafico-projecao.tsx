"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
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
  payload?: Array<{ value: number }>;
  label?: string;
};

function TooltipPersonalizado({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const valor = payload[0]!.value;
  return (
    <div className="rounded border bg-background px-3 py-2 text-sm shadow">
      <p className="font-medium">{label}</p>
      <p className={valor < 0 ? "text-destructive" : "text-green-600"}>
        {formatBRL(valor)}
      </p>
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

  // Cor da área: vermelha se algum ponto projetado for negativo
  const temNegativo = pontos.some((p) => p.saldoCentavos < 0);
  const corArea = temNegativo ? "#ef4444" : "#22c55e";
  const corAreaFill = temNegativo ? "#fee2e2" : "#dcfce7";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Projeção de caixa</CardTitle>
        <p className="text-xs text-muted-foreground">
          Saldo projetado após pagamento das contas em aberto por janela de tempo
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={pontos.map((p) => ({
              name: p.label,
              saldo: p.saldoCentavos,
            }))}
            margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={corArea} stopOpacity={0.3} />
                <stop offset="95%" stopColor={corAreaFill} stopOpacity={0} />
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
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
            <Area
              type="monotone"
              dataKey="saldo"
              stroke={corArea}
              strokeWidth={2}
              fill="url(#gradSaldo)"
              dot={{ r: 4, fill: corArea }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
