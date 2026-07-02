"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";

type Ponto = {
  data: string;
  gastoCentavos: number;
  vendasCentavos: number;
  cliques: number;
  impressoes: number;
  pedidos: number;
  acos: number | null;
  roas: number | null;
};

function formatDataCurta(iso: string): string {
  // espera YYYY-MM-DD
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}`;
}

// Investimento (barras) × Vendas atribuídas (área) × ACoS (linha) —
// as grandezas em R$ viraram séries visíveis; ROAS permanece no tooltip.
export function GraficoTimelineAds({
  de,
  ate,
  granularidade = "day",
}: {
  de: string;
  ate: string;
  granularidade?: "day" | "week";
}) {
  const { data, isLoading } = useQuery<Ponto[]>({
    queryKey: ["ads-timeline", de, ate, granularidade],
    queryFn: () =>
      fetchJSON<Ponto[]>(
        `/api/ads/timeline?de=${de}&ate=${ate}&granularidade=${granularidade}`,
      ),
  });

  const pontos = (data ?? []).map((p) => ({
    ...p,
    dataLabel: formatDataCurta(p.data),
    gasto: p.gastoCentavos / 100,
    vendas: p.vendasCentavos / 100,
    acosShow: p.acos != null ? Number(p.acos.toFixed(2)) : null,
  }));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Investimento × Vendas × ACoS
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : pontos.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            Sem dados no período selecionado.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={pontos}
                margin={{ top: 5, right: 8, bottom: 5, left: 8 }}
              >
                <defs>
                  <linearGradient id="gradVendasAds" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="dataLabel"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="reais"
                  width={70}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) =>
                    `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`
                  }
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  width={44}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0]?.payload as
                      | (Ponto & { gasto: number; vendas: number })
                      | undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-md border bg-background/95 p-2 text-xs shadow-md">
                        <div className="mb-1 font-medium">{label}</div>
                        <div className="space-y-0.5 tabular-nums">
                          <div>
                            Investido:{" "}
                            <strong>{formatBRL(p.gastoCentavos)}</strong>
                          </div>
                          <div>
                            Vendas:{" "}
                            <strong>{formatBRL(p.vendasCentavos)}</strong>
                          </div>
                          <div>
                            ACoS:{" "}
                            <strong>
                              {p.acos != null ? `${p.acos.toFixed(2)}%` : "—"}
                            </strong>
                          </div>
                          <div>
                            ROAS:{" "}
                            <strong>
                              {p.roas != null ? `${p.roas.toFixed(2)}x` : "—"}
                            </strong>
                          </div>
                          <div>
                            Cliques:{" "}
                            <strong>{p.cliques.toLocaleString("pt-BR")}</strong>
                          </div>
                          <div>
                            Impressões:{" "}
                            <strong>
                              {p.impressoes.toLocaleString("pt-BR")}
                            </strong>
                          </div>
                          <div>
                            Pedidos: <strong>{p.pedidos}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  yAxisId="reais"
                  dataKey="gasto"
                  fill="#f59e0b"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={26}
                  name="Investido (R$)"
                />
                <Area
                  yAxisId="reais"
                  type="monotone"
                  dataKey="vendas"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#gradVendasAds)"
                  dot={false}
                  name="Vendas atrib. (R$)"
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="acosShow"
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  name="ACoS %"
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
