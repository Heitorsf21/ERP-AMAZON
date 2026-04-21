"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Minus,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────────────────────
type DREData = {
  periodo: { de: string; ate: string };
  receitaAmazon: number;
  outrasReceitas: number;
  totalReceitas: number;
  taxasPlataforma: number;
  fretes: number;
  totalDeducoes: number;
  receitaLiquida: number;
  custoMercadorias: number;
  margemBruta: number;
  percentualMargemBruta: number;
  despesaMarketing: number;
  despesasOperacionais: Array<{ categoria: string; valor: number }>;
  totalDespesas: number;
  resultadoOperacional: number;
  roi: number;
  mpaValor: number;
  mpaPercentual: number;
  resultadoFinal: number;
  quantidadeLiquidacoes: number;
};

type Preset = "mes-atual" | "mes-anterior" | "trimestre" | "ano" | "custom";

// ── Helpers de período ─────────────────────────────────────────────────────────
function pad(n: number) {
  return String(n).padStart(2, "0");
}

function getPeriodo(preset: Preset): { de: string; ate: string } {
  const h = new Date();
  const y = h.getFullYear();
  const m = h.getMonth() + 1; // 1-based

  if (preset === "mes-atual") {
    const ultimo = new Date(y, h.getMonth() + 1, 0).getDate();
    return { de: `${y}-${pad(m)}-01`, ate: `${y}-${pad(m)}-${pad(ultimo)}` };
  }
  if (preset === "mes-anterior") {
    const ym = m === 1 ? y - 1 : y;
    const mm = m === 1 ? 12 : m - 1;
    const ultimo = new Date(ym, mm, 0).getDate();
    return { de: `${ym}-${pad(mm)}-01`, ate: `${ym}-${pad(mm)}-${pad(ultimo)}` };
  }
  if (preset === "trimestre") {
    const trimestre = Math.floor((m - 1) / 3);
    const mInicio = trimestre * 3 + 1;
    const mFim = mInicio + 2;
    const ultimo = new Date(y, mFim, 0).getDate();
    return { de: `${y}-${pad(mInicio)}-01`, ate: `${y}-${pad(mFim)}-${pad(ultimo)}` };
  }
  if (preset === "ano") {
    return { de: `${y}-01-01`, ate: `${y}-12-31` };
  }
  return { de: "", ate: "" };
}

// ── Sub-componentes ────────────────────────────────────────────────────────────
function KPICard({
  label,
  value,
  sub,
  trend,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  highlight?: "positive" | "negative" | "neutral";
}) {
  const cor =
    highlight === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : highlight === "negative"
        ? "text-destructive"
        : "text-foreground";

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex items-end gap-2">
          <p className={cn("text-2xl font-bold tabular-nums", cor)}>{value}</p>
          {trend === "up" && <TrendingUp className="mb-0.5 h-4 w-4 text-emerald-500" />}
          {trend === "down" && <TrendingDown className="mb-0.5 h-4 w-4 text-destructive" />}
        </div>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// Linha da tabela DRE
type TipoLinha = "grupo" | "item" | "subtotal" | "resultado";

function DRERow({
  label,
  valor,
  percentual,
  tipo,
  indent,
  sinal,
}: {
  label: string;
  valor: number;
  percentual?: number;
  tipo: TipoLinha;
  indent?: boolean;
  sinal?: "positivo" | "negativo" | "neutro";
}) {
  const isZero = valor === 0;

  const valorCor =
    sinal === "positivo"
      ? "text-emerald-600 dark:text-emerald-400"
      : sinal === "negativo"
        ? "text-destructive"
        : "text-foreground";

  if (tipo === "grupo") {
    return (
      <tr className="border-t border-border/40 bg-muted/30">
        <td
          colSpan={3}
          className="py-2 pl-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </td>
      </tr>
    );
  }

  if (tipo === "subtotal" || tipo === "resultado") {
    const bg =
      tipo === "resultado"
        ? sinal === "positivo"
          ? "bg-emerald-50 dark:bg-emerald-950/30"
          : sinal === "negativo"
            ? "bg-red-50 dark:bg-red-950/30"
            : "bg-muted/50"
        : "bg-muted/50";

    return (
      <tr className={cn("border-t-2 border-border", bg)}>
        <td className="py-3 pl-4 text-sm font-bold">{label}</td>
        <td className={cn("py-3 pr-4 text-right font-mono font-bold text-sm", valorCor)}>
          {isZero ? "—" : formatBRL(Math.abs(valor))}
        </td>
        <td className="py-3 pr-4 text-right text-xs text-muted-foreground">
          {percentual !== undefined && !isZero
            ? `${percentual >= 0 ? "+" : ""}${percentual.toFixed(1)}%`
            : ""}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-border/20 hover:bg-muted/20 transition-colors">
      <td className={cn("py-2.5 text-sm", indent ? "pl-8" : "pl-4")}>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {indent && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />}
          {label}
        </span>
      </td>
      <td
        className={cn(
          "py-2.5 pr-4 text-right font-mono text-sm tabular-nums",
          isZero ? "text-muted-foreground/40" : valorCor,
        )}
      >
        {isZero ? "—" : (sinal === "negativo" ? "−" : "") + formatBRL(Math.abs(valor))}
      </td>
      <td className="py-2.5 pr-4 text-right text-xs text-muted-foreground">
        {percentual !== undefined && !isZero ? `${percentual.toFixed(1)}%` : ""}
      </td>
    </tr>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function DREPage() {
  const [preset, setPreset] = React.useState<Preset>("mes-atual");
  const [customDe, setCustomDe] = React.useState("");
  const [customAte, setCustomAte] = React.useState("");

  const { de, ate } = React.useMemo(() => {
    if (preset === "custom") return { de: customDe, ate: customAte };
    return getPeriodo(preset);
  }, [preset, customDe, customAte]);

  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);

  const { data, isLoading } = useQuery<DREData>({
    queryKey: ["dre-resumo", de, ate],
    queryFn: () => fetchJSON<DREData>(`/api/dre/resumo?${params.toString()}`),
    enabled: !!de && !!ate,
  });

  const presets: { key: Preset; label: string }[] = [
    { key: "mes-atual", label: "Este mês" },
    { key: "mes-anterior", label: "Mês anterior" },
    { key: "trimestre", label: "Este trimestre" },
    { key: "ano", label: "Este ano" },
    { key: "custom", label: "Personalizado" },
  ];

  const d = data;

  // Gráfico de despesas
  const graficoDados =
    d?.despesasOperacionais
      .filter((x) => x.valor > 0)
      .map((x) => ({ name: x.categoria.replace(/ e /g, "/"), valor: x.valor })) ?? [];

  const CORES = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="DRE"
        description="Demonstração do Resultado do Exercício — visão financeira consolidada."
      >
        <Badge variant="outline" className="gap-1">
          <BarChart3 className="h-3 w-3" />
          Analítico
        </Badge>
      </PageHeader>

      {/* Seletor de período */}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <Button
            key={p.key}
            variant={preset === p.key ? "default" : "outline"}
            size="sm"
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              value={customDe}
              onChange={(e) => setCustomDe(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input
              type="date"
              value={customAte}
              onChange={(e) => setCustomAte(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {!isLoading && d && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard
              label="Receita Líquida"
              value={formatBRL(d.receitaLiquida)}
              sub={`${d.quantidadeLiquidacoes} liquidação(ões) Amazon`}
              highlight={d.receitaLiquida >= 0 ? "positive" : "negative"}
            />
            <KPICard
              label="Margem Bruta"
              value={`${d.percentualMargemBruta.toFixed(1)}%`}
              sub={formatBRL(d.margemBruta)}
              trend={d.margemBruta >= 0 ? "up" : "down"}
              highlight={d.margemBruta >= 0 ? "positive" : "negative"}
            />
            <KPICard
              label="ROI"
              value={`${d.roi.toFixed(1)}%`}
              sub="resultado / CMV"
              trend={d.roi >= 0 ? "up" : "down"}
              highlight={d.roi >= 30 ? "positive" : d.roi >= 0 ? "neutral" : "negative"}
            />
            <KPICard
              label="MPA"
              value={`${d.mpaPercentual.toFixed(1)}%`}
              sub={`Margem pós-anúncio: ${formatBRL(d.mpaValor)}`}
              trend={d.mpaPercentual >= 0 ? "up" : "down"}
              highlight={d.mpaPercentual >= 20 ? "positive" : d.mpaPercentual >= 0 ? "neutral" : "negative"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Tabela DRE */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  Demonstração do Resultado
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {de} → {ate}
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-2 pl-4 text-left text-xs font-medium text-muted-foreground">
                        Linha
                      </th>
                      <th className="py-2 pr-4 text-right text-xs font-medium text-muted-foreground">
                        Valor
                      </th>
                      <th className="py-2 pr-4 text-right text-xs font-medium text-muted-foreground">
                        % Receita
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* RECEITAS */}
                    <DRERow label="Receitas" valor={0} tipo="grupo" />
                    <DRERow
                      label="Receita Amazon"
                      valor={d.receitaAmazon}
                      percentual={d.totalReceitas > 0 ? (d.receitaAmazon / d.totalReceitas) * 100 : 0}
                      tipo="item"
                      indent
                      sinal="positivo"
                    />
                    <DRERow
                      label="Outras receitas (manuais)"
                      valor={d.outrasReceitas}
                      percentual={d.totalReceitas > 0 ? (d.outrasReceitas / d.totalReceitas) * 100 : 0}
                      tipo="item"
                      indent
                      sinal="positivo"
                    />
                    <DRERow
                      label="Receita Bruta"
                      valor={d.totalReceitas}
                      percentual={100}
                      tipo="subtotal"
                      sinal="positivo"
                    />

                    {/* DEDUÇÕES */}
                    <DRERow label="Deduções" valor={0} tipo="grupo" />
                    <DRERow
                      label="Taxas de plataforma"
                      valor={d.taxasPlataforma}
                      percentual={d.totalReceitas > 0 ? (d.taxasPlataforma / d.totalReceitas) * 100 : 0}
                      tipo="item"
                      indent
                      sinal="negativo"
                    />
                    <DRERow
                      label="Fretes e Entregas"
                      valor={d.fretes}
                      percentual={d.totalReceitas > 0 ? (d.fretes / d.totalReceitas) * 100 : 0}
                      tipo="item"
                      indent
                      sinal="negativo"
                    />
                    <DRERow
                      label="Receita Líquida"
                      valor={d.receitaLiquida}
                      percentual={d.totalReceitas > 0 ? (d.receitaLiquida / d.totalReceitas) * 100 : 0}
                      tipo="subtotal"
                      sinal={d.receitaLiquida >= 0 ? "positivo" : "negativo"}
                    />

                    {/* CMV */}
                    <DRERow label="Custo das Mercadorias Vendidas" valor={0} tipo="grupo" />
                    <DRERow
                      label="CMV"
                      valor={d.custoMercadorias}
                      percentual={d.totalReceitas > 0 ? (d.custoMercadorias / d.totalReceitas) * 100 : 0}
                      tipo="item"
                      indent
                      sinal="negativo"
                    />
                    <DRERow
                      label="Margem Bruta"
                      valor={d.margemBruta}
                      percentual={d.percentualMargemBruta}
                      tipo="subtotal"
                      sinal={d.margemBruta >= 0 ? "positivo" : "negativo"}
                    />

                    {/* DESPESAS OPERACIONAIS */}
                    <DRERow label="Despesas Operacionais" valor={0} tipo="grupo" />
                    {d.despesasOperacionais.map((dep) => (
                      <DRERow
                        key={dep.categoria}
                        label={dep.categoria}
                        valor={dep.valor}
                        percentual={d.totalReceitas > 0 ? (dep.valor / d.totalReceitas) * 100 : 0}
                        tipo="item"
                        indent
                        sinal="negativo"
                      />
                    ))}
                    {d.despesasOperacionais.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="py-2 pl-8 text-xs text-muted-foreground/50 italic"
                        >
                          Nenhuma despesa operacional no período
                        </td>
                      </tr>
                    )}

                    {/* RESULTADO FINAL */}
                    <DRERow
                      label="Resultado Final"
                      valor={d.resultadoFinal}
                      percentual={
                        d.totalReceitas > 0 ? (d.resultadoFinal / d.totalReceitas) * 100 : 0
                      }
                      tipo="resultado"
                      sinal={d.resultadoFinal >= 0 ? "positivo" : "negativo"}
                    />
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Coluna direita: indicadores + gráfico */}
            <div className="space-y-4">
              {/* Indicadores financeiros */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Indicadores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {[
                    {
                      label: "Margem Bruta",
                      valor: `${d.percentualMargemBruta.toFixed(1)}%`,
                      ok: d.percentualMargemBruta >= 30,
                    },
                    {
                      label: "Margem Líquida",
                      valor:
                        d.totalReceitas > 0
                          ? `${((d.resultadoFinal / d.totalReceitas) * 100).toFixed(1)}%`
                          : "—",
                      ok: d.resultadoFinal > 0,
                    },
                    {
                      label: "ROI sobre CMV",
                      valor: d.custoMercadorias > 0 ? `${d.roi.toFixed(1)}%` : "—",
                      ok: d.roi >= 30,
                    },
                    {
                      label: "MPA (pós-anúncio)",
                      valor: `${d.mpaPercentual.toFixed(1)}%`,
                      ok: d.mpaPercentual >= 20,
                    },
                    {
                      label: "Participação Amazon",
                      valor:
                        d.totalReceitas > 0
                          ? `${((d.receitaAmazon / d.totalReceitas) * 100).toFixed(0)}%`
                          : "—",
                      ok: true,
                    },
                    {
                      label: "Custo/Receita",
                      valor:
                        d.totalReceitas > 0
                          ? `${((d.custoMercadorias / d.totalReceitas) * 100).toFixed(1)}%`
                          : "—",
                      ok: d.totalReceitas > 0 && d.custoMercadorias / d.totalReceitas < 0.6,
                    },
                  ].map((ind) => (
                    <div key={ind.label} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{ind.label}</span>
                      <span
                        className={cn(
                          "font-mono font-semibold tabular-nums",
                          ind.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                        )}
                      >
                        {ind.valor}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Gráfico de despesas por categoria */}
              {graficoDados.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Despesas por Categoria</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={graficoDados}
                        layout="vertical"
                        margin={{ left: 0, right: 16 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis
                          type="number"
                          tickFormatter={(v) =>
                            v >= 100000
                              ? `R$${(v / 100000).toFixed(0)}k`
                              : formatBRL(v)
                          }
                          tick={{ fontSize: 10 }}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={90}
                          tick={{ fontSize: 10 }}
                        />
                        <Tooltip
                          formatter={(v: number) => [formatBRL(v), "Valor"]}
                          contentStyle={{ fontSize: 12 }}
                        />
                        <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                          {graficoDados.map((_, i) => (
                            <Cell key={i} fill={CORES[i % CORES.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Estrutura de resultado */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Composição do Resultado</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {[
                    { label: "Receita Líquida", valor: d.receitaLiquida, positivo: true },
                    { label: "(-) CMV", valor: -d.custoMercadorias, positivo: false },
                    { label: "(-) Marketing", valor: -d.despesaMarketing, positivo: false },
                    { label: "(-) Outros custos", valor: -(d.totalDespesas - d.despesaMarketing), positivo: false },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span
                        className={cn(
                          "font-mono tabular-nums",
                          item.valor >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive",
                        )}
                      >
                        {item.valor >= 0 ? "+" : ""}
                        {formatBRL(Math.abs(item.valor))}
                      </span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex items-center justify-between font-bold">
                    <span>Resultado Final</span>
                    <span
                      className={
                        d.resultadoFinal >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                      }
                    >
                      {formatBRL(d.resultadoFinal)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      {!isLoading && !d && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 py-20 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Selecione um período para visualizar o DRE.
          </p>
        </div>
      )}
    </div>
  );
}
