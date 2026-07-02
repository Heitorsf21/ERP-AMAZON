"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { X } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProductThumb } from "@/components/ui/product-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { cn } from "@/lib/utils";

// Paleta da pizza — mesma família do donut da ficha Amazon (CORES_PIE);
// slate reservado para a fatia agregada "Outros".
const CORES = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];
const COR_OUTROS = "#94a3b8";
const MAX_FATIAS = 7;
const OUTROS_KEY = "__outros";

type LinhaSku = {
  sku: string;
  asin: string | null;
  gastoCentavos: number;
  vendasCentavos: number;
  acos: number | null;
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
};

type Fatia = {
  sku: string;
  nomeLista: string;
  gastoCentavos: number;
  vendasCentavos: number;
  acos: number | null;
  cor: string;
  selecionavel: boolean;
  linha: LinhaSku | null;
  agrupados: number;
};

type Props = {
  skuSelecionado: string | null;
  onSelecionar: (sku: string | null) => void;
  /** Contagem de recomendações pendentes (PROPOSED) por SKU, vinda do snapshot. */
  recPendentesPorSku: Map<string, number>;
};

function corAcos(acos: number | null): string {
  if (acos == null) return "text-muted-foreground";
  if (acos >= 35) return "text-red-600 dark:text-red-400";
  if (acos >= 25) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function acosPercent(gasto: number, vendas: number): number | null {
  if (vendas <= 0) return null;
  return (gasto / vendas) * 100;
}

/**
 * Hero do Otimizador: pizza do investimento de Ads por produto (últimos 30d,
 * fonte /api/ads/por-sku) + lista clicável. Selecionar uma fatia/produto
 * mostra o banner do produto e avisa a página para filtrar as recomendações.
 */
export function InvestimentoPorProduto({
  skuSelecionado,
  onSelecionar,
  recPendentesPorSku,
}: Props) {
  const periodo = React.useMemo(() => {
    const hoje = new Date();
    return {
      de: format(subDays(hoje, 29), "yyyy-MM-dd"),
      ate: format(hoje, "yyyy-MM-dd"),
    };
  }, []);

  const { data, isLoading } = useQuery<LinhaSku[]>({
    queryKey: ["ads-por-sku", periodo.de, periodo.ate],
    queryFn: () =>
      fetchJSON<LinhaSku[]>(
        `/api/ads/por-sku?de=${periodo.de}&ate=${periodo.ate}`,
      ),
  });

  const fatias = React.useMemo<Fatia[]>(() => {
    const comGasto = (data ?? [])
      .filter((l) => l.gastoCentavos > 0)
      .sort((a, b) => b.gastoCentavos - a.gastoCentavos);
    if (comGasto.length === 0) return [];

    const principais = comGasto.slice(0, MAX_FATIAS);
    const resto = comGasto.slice(MAX_FATIAS);

    const lista: Fatia[] = principais.map((l, i) => {
      // O acos do endpoint vem em fração ou percentual conforme a fonte;
      // recalcular do gasto/vendas garante consistência na UI.
      const acos = acosPercent(l.gastoCentavos, l.vendasCentavos);
      return {
        sku: l.sku,
        nomeLista: l.sku,
        gastoCentavos: l.gastoCentavos,
        vendasCentavos: l.vendasCentavos,
        acos,
        cor: CORES[i % CORES.length] ?? COR_OUTROS,
        selecionavel: true,
        linha: l,
        agrupados: 0,
      };
    });

    if (resto.length > 0) {
      const gasto = resto.reduce((s, l) => s + l.gastoCentavos, 0);
      const vendas = resto.reduce((s, l) => s + l.vendasCentavos, 0);
      lista.push({
        sku: OUTROS_KEY,
        nomeLista: `Outros ${resto.length} produtos`,
        gastoCentavos: gasto,
        vendasCentavos: vendas,
        acos: acosPercent(gasto, vendas),
        cor: COR_OUTROS,
        selecionavel: false,
        linha: null,
        agrupados: resto.length,
      });
    }
    return lista;
  }, [data]);

  const totalGasto = React.useMemo(
    () => fatias.reduce((s, f) => s + f.gastoCentavos, 0),
    [fatias],
  );
  const totalProdutos = React.useMemo(
    () => (data ?? []).filter((l) => l.gastoCentavos > 0).length,
    [data],
  );

  const selecionada = fatias.find((f) => f.sku === skuSelecionado) ?? null;

  function alternar(fatia: Fatia) {
    if (!fatia.selecionavel) return;
    onSelecionar(skuSelecionado === fatia.sku ? null : fatia.sku);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Investimento por produto</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Últimos 30 dias · clique numa fatia ou num produto para ver as
                recomendações do sistema.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              Fonte: métricas diárias por SKU (Ads API)
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="mx-auto h-64 w-64 rounded-full" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          ) : fatias.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground">
              Sem investimento de Ads nos últimos 30 dias.
            </div>
          ) : (
            <div className="grid items-center gap-6 lg:grid-cols-2">
              {/* Donut */}
              <div className="relative mx-auto h-64 w-64 sm:h-72 sm:w-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fatias}
                      dataKey="gastoCentavos"
                      nameKey="nomeLista"
                      cx="50%"
                      cy="50%"
                      innerRadius="58%"
                      outerRadius="92%"
                      paddingAngle={1.5}
                      strokeWidth={0}
                      onClick={(_, index) => {
                        const fatia = fatias[index];
                        if (fatia) alternar(fatia);
                      }}
                    >
                      {fatias.map((f) => (
                        <Cell
                          key={f.sku}
                          fill={f.cor}
                          cursor={f.selecionavel ? "pointer" : "default"}
                          opacity={
                            skuSelecionado && f.sku !== skuSelecionado ? 0.35 : 1
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatBRL(value),
                        name,
                      ]}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        color: "hsl(var(--popover-foreground))",
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="max-w-[55%] text-center">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {selecionada ? selecionada.nomeLista : "Investido 30d"}
                    </p>
                    <p className="text-xl font-bold tabular-nums sm:text-2xl">
                      {formatBRL(
                        selecionada ? selecionada.gastoCentavos : totalGasto,
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selecionada
                        ? `${totalGasto > 0 ? ((selecionada.gastoCentavos / totalGasto) * 100).toFixed(1) : "0"}% do investimento`
                        : `${totalProdutos} produto${totalProdutos === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </div>
              </div>

              {/* Lista-legenda clicável */}
              <div className="divide-y overflow-hidden rounded-lg border">
                {fatias.map((f) => {
                  const pendentes = f.selecionavel
                    ? (recPendentesPorSku.get(f.sku) ?? 0)
                    : f.agrupados > 0
                      ? [...recPendentesPorSku.entries()]
                          .filter(([sku]) => !fatias.some((x) => x.sku === sku))
                          .reduce((s, [, n]) => s + n, 0)
                      : 0;
                  const ativo = skuSelecionado === f.sku;
                  const pct =
                    totalGasto > 0
                      ? ((f.gastoCentavos / totalGasto) * 100).toFixed(1)
                      : "0";
                  return (
                    <button
                      key={f.sku}
                      type="button"
                      onClick={() => alternar(f)}
                      disabled={!f.selecionavel}
                      className={cn(
                        "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                        f.selecionavel && "hover:bg-muted",
                        !f.selecionavel && "cursor-default",
                        ativo && "bg-muted",
                      )}
                      style={
                        ativo ? { boxShadow: `inset 3px 0 0 ${f.cor}` } : undefined
                      }
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: f.cor }}
                      />
                      {f.linha ? (
                        <ProductThumb
                          src={resolverImagemProduto(
                            f.linha.amazonImagemUrl,
                            f.linha.asin,
                            f.linha.imagemUrl,
                          )}
                          alt={f.sku}
                          size={32}
                        />
                      ) : (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-xs text-muted-foreground">
                          +{f.agrupados}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {f.nomeLista}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {f.selecionavel ? (f.linha?.asin ?? "sem ASIN") : "agrupados"}
                          {" · ACoS "}
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              corAcos(f.acos),
                            )}
                          >
                            {f.acos != null ? `${f.acos.toFixed(1)}%` : "—"}
                          </span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatBRL(f.gastoCentavos)}
                        </p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          {pct}%
                        </p>
                      </div>
                      {pendentes > 0 ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-primary">
                          {pendentes} rec.
                        </span>
                      ) : (
                        <span className="w-8 shrink-0 text-center text-[10px] text-muted-foreground">
                          —
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deep-link (?sku=) para produto sem gasto 30d: a fatia não existe no
          donut — dá contexto mesmo assim, em vez de uma seleção invisível. */}
      {!selecionada && skuSelecionado && !isLoading && (
        <Card className="relative overflow-hidden">
          <span
            aria-hidden
            className="absolute bottom-0 left-0 top-0 w-1 bg-slate-400"
          />
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div>
              <p className="font-semibold">{skuSelecionado}</p>
              <p className="text-xs text-muted-foreground">
                Sem investimento de Ads nos últimos 30 dias — mostrando as
                recomendações do produto abaixo, se houver.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSelecionar(null)}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Limpar seleção
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Banner do produto selecionado */}
      {selecionada && (
        <Card className="relative overflow-hidden">
          <span
            aria-hidden
            className={cn(
              "absolute bottom-0 left-0 top-0 w-1",
              selecionada.acos == null
                ? "bg-slate-400"
                : selecionada.acos >= 35
                  ? "bg-red-500"
                  : selecionada.acos >= 25
                    ? "bg-amber-500"
                    : "bg-emerald-500",
            )}
          />
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              {selecionada.linha && (
                <ProductThumb
                  src={resolverImagemProduto(
                    selecionada.linha.amazonImagemUrl,
                    selecionada.linha.asin,
                    selecionada.linha.imagemUrl,
                  )}
                  alt={selecionada.sku}
                  size={48}
                />
              )}
              <div>
                <p className="font-semibold">{selecionada.sku}</p>
                <p className="text-xs text-muted-foreground">
                  {selecionada.linha?.asin ?? "—"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Gasto 30d
                </p>
                <p className="font-semibold tabular-nums">
                  {formatBRL(selecionada.gastoCentavos)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Vendas atrib.
                </p>
                <p className="font-semibold tabular-nums">
                  {formatBRL(selecionada.vendasCentavos)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  ACoS
                </p>
                <p
                  className={cn(
                    "font-semibold tabular-nums",
                    corAcos(selecionada.acos),
                  )}
                >
                  {selecionada.acos != null
                    ? `${selecionada.acos.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSelecionar(null)}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Limpar seleção
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
