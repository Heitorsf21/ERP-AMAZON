"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, AlertTriangle, TrendingDown, DollarSign } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CardSkeleton } from "@/components/ui/card-skeleton";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";

type Totais = {
  total: number;
  inativos: number;
  countRepor: number;
  countAtencao: number;
  valorTotalCentavos: number;
};

export function CardResumoEstoque() {
  const { data, isLoading } = useQuery<Totais>({
    queryKey: ["estoque-totais"],
    queryFn: () => fetchJSON<Totais>("/api/estoque/totais"),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Total produtos",
      value: data?.total ?? 0,
      sub: `${data?.inativos ?? 0} inativos`,
      icon: Package,
      color: "text-primary",
    },
    {
      label: "Repor urgente",
      value: data?.countRepor ?? 0,
      sub: "",
      icon: TrendingDown,
      color: data?.countRepor ? "text-destructive" : "text-success",
    },
    {
      label: "Atenção",
      value: data?.countAtencao ?? 0,
      sub: "",
      icon: AlertTriangle,
      color: data?.countAtencao ? "text-warning" : "text-success",
    },
    {
      label: "Valor em estoque",
      value: formatBRL(data?.valorTotalCentavos ?? 0),
      sub: "",
      icon: DollarSign,
      color: "text-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label} className="overflow-hidden">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    {c.label}
                  </p>
                  <p className={`text-2xl font-semibold tabular-nums ${c.color}`}>
                    {c.value}
                  </p>
                  {c.sub && <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>}
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <Icon className={`h-4 w-4 ${c.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
