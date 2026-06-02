"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Clock, FileText, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { PeriodoPreset } from "@/lib/periodo";
import type { FiltroPeriodoValue } from "@/components/ui/filtro-periodo";

type Totais = {
  compradoNoPeriodoCentavos: number;
  aReceberCentavos: number;
  rascunho: number;
  ticketMedioCentavos: number | null;
  pedidosNoPeriodo: number;
};

export function periodoParaQuery(periodo: FiltroPeriodoValue): string {
  const params = new URLSearchParams({ preset: periodo.preset });
  if (periodo.preset === PeriodoPreset.PERSONALIZADO && periodo.de && periodo.ate) {
    params.set("de", periodo.de);
    params.set("ate", periodo.ate);
  }
  return params.toString();
}

export function ComprasKpiCards({ periodo }: { periodo: FiltroPeriodoValue }) {
  const qs = periodoParaQuery(periodo);
  const { data } = useQuery<Totais>({
    queryKey: ["compras-totais", qs],
    queryFn: () => fetchJSON<Totais>(`/api/compras/totais?${qs}`),
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        color="border-l-blue-500"
        icon={ShoppingCart}
        label="Comprado no período"
        value={formatBRL(data?.compradoNoPeriodoCentavos ?? 0)}
        sub={`${data?.pedidosNoPeriodo ?? 0} pedido(s)`}
      />
      <Kpi
        color="border-l-amber-500"
        icon={Clock}
        label="A receber"
        value={formatBRL(data?.aReceberCentavos ?? 0)}
        sub="confirmados em aberto"
      />
      <Kpi
        color="border-l-slate-400"
        icon={FileText}
        label="Rascunhos"
        value={String(data?.rascunho ?? 0)}
        sub="não confirmados"
      />
      <Kpi
        color="border-l-emerald-500"
        icon={Receipt}
        label="Ticket médio"
        value={data?.ticketMedioCentavos != null ? formatBRL(data.ticketMedioCentavos) : "—"}
        sub="por pedido"
      />
    </div>
  );
}

function Kpi({
  color,
  icon: Icon,
  label,
  value,
  sub,
}: {
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className={cn("border-l-4", color)}>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground/60" />
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
