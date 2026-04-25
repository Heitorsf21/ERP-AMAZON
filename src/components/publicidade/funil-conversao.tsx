"use client";

import {
  Eye,
  MousePointerClick,
  ShoppingBag,
  DollarSign,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL } from "@/lib/money";

type FunilProps = {
  impressoes: number;
  cliques: number;
  pedidos: number;
  vendasCentavos: number;
  gastoCentavos: number;
};

function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR");
}

function fmtPct(num: number, den: number): string {
  if (den <= 0) return "—";
  return `${((num / den) * 100).toFixed(2)}%`;
}

export function FunilConversao({
  impressoes,
  cliques,
  pedidos,
  vendasCentavos,
  gastoCentavos,
}: FunilProps) {
  const cpcCentavos =
    cliques > 0 ? Math.round(gastoCentavos / cliques) : null;
  const ticketCentavos =
    pedidos > 0 ? Math.round(vendasCentavos / pedidos) : null;

  return (
    <Card>
      <CardContent className="py-4">
        <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          Funil de conversão
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <Etapa
            icon={Eye}
            label="Impressões"
            valor={fmtNum(impressoes)}
            metrica={null}
          />
          <Seta />
          <Etapa
            icon={MousePointerClick}
            label="Cliques"
            valor={fmtNum(cliques)}
            metrica={`CTR ${fmtPct(cliques, impressoes)}`}
          />
          <Seta />
          <Etapa
            icon={ShoppingBag}
            label="Pedidos"
            valor={fmtNum(pedidos)}
            metrica={`Conv. ${fmtPct(pedidos, cliques)}`}
          />
          <Seta />
          <Etapa
            icon={DollarSign}
            label="Vendas atrib."
            valor={vendasCentavos > 0 ? formatBRL(vendasCentavos) : "—"}
            metrica={
              ticketCentavos != null ? `Ticket ${formatBRL(ticketCentavos)}` : null
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            CPC médio:{" "}
            <strong className="text-foreground tabular-nums">
              {cpcCentavos != null ? formatBRL(cpcCentavos) : "—"}
            </strong>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Etapa({
  icon: Icon,
  label,
  valor,
  metrica,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  valor: string;
  metrica: string | null;
}) {
  return (
    <div className="rounded-md border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{valor}</div>
      {metrica && (
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {metrica}
        </div>
      )}
    </div>
  );
}

function Seta() {
  return (
    <div className="hidden items-center justify-center text-muted-foreground/40 md:flex">
      <ChevronRight className="h-5 w-5" />
    </div>
  );
}
