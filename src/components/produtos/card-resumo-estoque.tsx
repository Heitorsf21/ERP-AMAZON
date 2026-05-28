"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Package,
  AlertTriangle,
  TrendingDown,
  DollarSign,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CardSkeleton } from "@/components/ui/card-skeleton";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import {
  DEFAULT_PRODUTO_FILTROS,
  produtoFiltrosToSearchParams,
  type ProdutoFiltrosQuery,
} from "@/modules/estoque/filtros";

type Totais = {
  total: number;
  inativos: number;
  countRepor: number;
  countAtencao: number;
  valorTotalCentavos: number;
  custoEstoqueCentavos: number;
  receitaPotencialCentavos: number;
  unidadesVendaveis: number;
  produtosSemCusto: number;
  unidadesSemCusto: number;
  produtosSemPreco: number;
  unidadesSemPreco: number;
  produtosSemSyncAmazon: number;
};

type Props = {
  filtros?: ProdutoFiltrosQuery;
};

function resumoCobertura(
  data: Totais | undefined,
  tipo: "custo" | "receita" | "total",
) {
  if (!data) return "";

  const alertas: string[] = [];
  if (data.produtosSemSyncAmazon > 0) {
    alertas.push(`${data.produtosSemSyncAmazon} sem sync Amazon`);
  }
  if (tipo === "custo" && data.produtosSemCusto > 0) {
    alertas.push(`${data.produtosSemCusto} sem custo`);
  }
  if (tipo === "receita" && data.produtosSemPreco > 0) {
    alertas.push(`${data.produtosSemPreco} sem preço`);
  }

  if (alertas.length > 0) return alertas.slice(0, 2).join(" · ");
  return `${data.unidadesVendaveis} un. vendáveis`;
}

export function CardResumoEstoque({ filtros = DEFAULT_PRODUTO_FILTROS }: Props) {
  const qs = produtoFiltrosToSearchParams(filtros).toString();
  const url = `/api/estoque/totais${qs ? `?${qs}` : ""}`;

  const { data, isLoading } = useQuery<Totais>({
    queryKey: ["estoque-totais", qs],
    queryFn: () => fetchJSON<Totais>(url),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Total produtos",
      value: data?.total ?? 0,
      sub:
        data?.inativos && data.inativos > 0
          ? `${data.inativos} inativos`
          : resumoCobertura(data, "total"),
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
      label: "Custo do estoque",
      value: formatBRL(data?.custoEstoqueCentavos ?? data?.valorTotalCentavos ?? 0),
      sub: resumoCobertura(data, "custo"),
      icon: DollarSign,
      color: "text-foreground",
    },
    {
      label: "Receita potencial",
      value: formatBRL(data?.receitaPotencialCentavos ?? 0),
      sub: resumoCobertura(data, "receita"),
      icon: TrendingUp,
      color: "text-success",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
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
                  <p className={`text-xl font-semibold leading-tight tabular-nums 2xl:text-2xl ${c.color}`}>
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
