"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// Funil vertical compacto — desenhado para o rail lateral do gráfico
// (grid 2/3 + 1/3 da página de Publicidade).
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
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Funil de conversão</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="space-y-2">
          <Etapa label="Impressões" valor={fmtNum(impressoes)} />
          <Conector metrica={`CTR ${fmtPct(cliques, impressoes)}`} />
          <Etapa label="Cliques" valor={fmtNum(cliques)} />
          <Conector metrica={`Conversão ${fmtPct(pedidos, cliques)}`} />
          <Etapa label="Pedidos" valor={fmtNum(pedidos)} />
          <Conector
            metrica={
              ticketCentavos != null
                ? `Ticket médio ${formatBRL(ticketCentavos)}`
                : "Ticket médio —"
            }
          />
          <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              Vendas atribuídas
            </span>
            <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {vendasCentavos > 0 ? formatBRL(vendasCentavos) : "—"}
            </span>
          </div>
        </div>
        <p className="mt-auto border-t pt-2.5 text-[11px] text-muted-foreground">
          CPC médio{" "}
          <strong className="tabular-nums text-foreground">
            {cpcCentavos != null ? formatBRL(cpcCentavos) : "—"}
          </strong>
        </p>
      </CardContent>
    </Card>
  );
}

function Etapa({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{valor}</span>
    </div>
  );
}

function Conector({ metrica }: { metrica: string }) {
  return (
    <div className="pl-3 text-[11px] text-muted-foreground tabular-nums">
      ↓ {metrica}
    </div>
  );
}
