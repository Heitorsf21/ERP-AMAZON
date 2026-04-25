"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
    roasShow: p.roas != null ? Number(p.roas.toFixed(2)) : null,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Evolução de ACoS e ROAS
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : pontos.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Sem dados no período selecionado.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={pontos}
                margin={{ top: 5, right: 16, bottom: 5, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis dataKey="dataLabel" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  label={{
                    value: "ACoS",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 11 },
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}x`}
                  label={{
                    value: "ROAS",
                    angle: 90,
                    position: "insideRight",
                    style: { fontSize: 11 },
                  }}
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
                            Gasto:{" "}
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
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="acosShow"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="ACoS %"
                  connectNulls
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="roasShow"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="ROAS"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
