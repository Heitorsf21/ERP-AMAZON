"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ShoppingCart, Clock, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";

type Totais = {
  rascunho: number;
  confirmado: number;
  totalComprometidoCentavos: number;
};

export function CardResumoCompras() {
  const { data, isLoading } = useQuery<Totais>({
    queryKey: ["compras-totais"],
    queryFn: () => fetchJSON<Totais>("/api/compras/totais"),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card
        label="Rascunhos"
        value={data?.rascunho ?? 0}
        sub="pedidos"
        icon={ShoppingCart}
        color="muted"
      />
      <Card
        label="Pedidos Confirmados"
        value={data?.confirmado ?? 0}
        sub="aguardando entrega"
        icon={Clock}
        color="warning"
      />
      <Card
        label="Total Comprometido"
        value={formatBRL(data?.totalComprometidoCentavos ?? 0)}
        icon={CheckCircle}
        color="blue"
      />
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "muted" | "warning" | "blue" | "green";
}) {
  const colorMap = {
    muted: "bg-muted/40 text-muted-foreground",
    warning: "bg-warning/10 text-warning",
    blue: "bg-primary/10 text-primary",
    green: "bg-success/10 text-success",
  };

  return (
    <Link href="/compras" className="rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors block">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className={`rounded-lg p-2 ${colorMap[color]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Link>
  );
}
