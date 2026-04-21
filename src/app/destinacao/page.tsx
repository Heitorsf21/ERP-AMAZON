"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
  ShoppingCart,
  Clock,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Resumo = {
  saldoAtual: number;
  comprometidoContas: number;
  comprometidoComprasCount: number;
  comprometidoCompras: number;
  totalComprometido: number;
  contasAbertasCount: number;
  aReceber: number;
  aReceberCount: number;
  saldoLivre: number;
  saldoProjetado: number;
};

export default function DestinacaoPage() {
  const { data, isLoading } = useQuery<Resumo>({
    queryKey: ["destinacao-resumo"],
    queryFn: () => fetchJSON<Resumo>("/api/destinacao/resumo"),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const chartData = [
    {
      name: "Saldo Livre",
      value: Math.max(data.saldoLivre, 0),
      color: "hsl(var(--success))",
    },
    {
      name: "Contas a Pagar",
      value: data.comprometidoContas,
      color: "hsl(var(--destructive))",
    },
    {
      name: "Compras Confirmadas",
      value: data.comprometidoCompras,
      color: "hsl(var(--warning))",
    },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Destinação de Caixa"
        description="Visão do saldo comprometido vs. disponível."
      />

      {/* Hero — saldo livre */}
      <div
        className={cn(
          "rounded-2xl border p-6",
          data.saldoLivre >= 0
            ? "border-success/20 bg-success/5"
            : "border-destructive/20 bg-destructive/5",
        )}
      >
        <p className="text-sm font-medium text-muted-foreground">
          Saldo Livre (caixa − comprometimentos)
        </p>
        <p
          className={cn(
            "mt-1 text-4xl font-bold tabular-nums",
            data.saldoLivre >= 0 ? "text-success" : "text-destructive",
          )}
        >
          {formatBRL(data.saldoLivre)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Saldo projetado com recebíveis: {formatBRL(data.saldoProjetado)}
        </p>
      </div>

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Saldo Atual em Caixa"
          value={formatBRL(data.saldoAtual)}
          icon={Wallet}
          color="blue"
        />
        <MetricCard
          label="Contas a Pagar em Aberto"
          value={formatBRL(data.comprometidoContas)}
          sub={`${data.contasAbertasCount} conta(s)`}
          icon={TrendingDown}
          color="red"
        />
        <MetricCard
          label="Pedidos de Compra Confirmados"
          value={formatBRL(data.comprometidoCompras)}
          sub={`${data.comprometidoComprasCount} pedido(s)`}
          icon={ShoppingCart}
          color="orange"
        />
        <MetricCard
          label="Total Comprometido"
          value={formatBRL(data.totalComprometido)}
          icon={PiggyBank}
          color="red"
        />
        <MetricCard
          label="A Receber (Amazon)"
          value={formatBRL(data.aReceber)}
          sub={`${data.aReceberCount} liquidação(ões)`}
          icon={Clock}
          color="green"
        />
        <MetricCard
          label="Saldo Projetado"
          value={formatBRL(data.saldoProjetado)}
          sub="Livre + A receber"
          icon={TrendingUp}
          color={data.saldoProjetado >= 0 ? "green" : "red"}
        />
      </div>

      {/* Gráfico de destinação */}
      {chartData.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold">Destinação do Caixa</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={110}
                paddingAngle={3}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [formatBRL(value), ""]}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <Legend
                formatter={(value) => (
                  <span className="text-xs text-muted-foreground">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const colorMap = {
  blue: "text-primary bg-primary/10",
  green: "text-success bg-success/10",
  red: "text-destructive bg-destructive/10",
  orange: "text-warning bg-warning/10",
};

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "green" | "red" | "orange";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={cn("rounded-lg p-2", colorMap[color])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
