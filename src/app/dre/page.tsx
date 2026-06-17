"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  ChevronRight,
  Printer,
  CalendarDays,
  Info,
  AlertTriangle,
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
import { KpiCard } from "@/components/ui/kpi-card";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Regime = "competencia" | "caixa";

type DreLinhaDespesa = { categoria: string; valor: number };

// Regime de CAIXA (estrutura histórica)
type DRECaixaData = {
  regime?: "caixa";
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
  despesasOperacionais: DreLinhaDespesa[];
  totalDespesas: number;
  resultadoOperacional: number;
  roi: number;
  mpaValor: number;
  mpaPercentual: number;
  resultadoFinal: number;
  quantidadeLiquidacoes: number;
  amazon: {
    receitaLiquidacoes: number;
    reimbursementsFba: number;
    returnsEstimados: number;
    storageFees: number;
    quantidadeReimbursementsFba: number;
    quantidadeReturns: number;
    quantidadeStorageFees: number;
    unidadesReturns: number;
  };
  cpv: {
    calculado: number;
    contasPagas: number;
    storageFees: number;
  };
};

type OrigemTaxasDre = "real" | "estimado" | "misto" | "nenhuma";

// Regime de COMPETÊNCIA (novo)
type DRECompetenciaData = {
  regime: "competencia";
  periodo: { de: string; ate: string };
  receitaBrutaVendas: number;
  reembolsos: number;
  receitaLiquidaVendas: number;
  taxasAmazon: number;
  fretes: number;
  impostoSimples: number;
  receitaOperacionalLiquida: number;
  cmv: number;
  custoIncompleto: boolean;
  vendasSemCusto: number;
  lucroBruto: number;
  margemBrutaPercentual: number;
  ads: number;
  adsFonte: string;
  despesasOperacionais: DreLinhaDespesa[];
  totalDespesasOperacionais: number;
  lucroOperacional: number;
  outrasReceitasManuais: number;
  outrasDespesasManuais: number;
  lucroLiquido: number;
  margemLiquidaPercentual: number;
  origemTaxas: OrigemTaxasDre;
  quantidadeVendas: number;
  unidades: number;
  // chaves de compatibilidade anual
  totalReceitas: number;
  receitaLiquida: number;
  margemBruta: number;
  custoMercadorias: number;
  resultadoFinal: number;
  roi: number;
};

type DREResposta = DRECaixaData | DRECompetenciaData;

type Preset = "mes-atual" | "mes-anterior" | "trimestre" | "ano" | "custom" | "anual";

type MesDRE = {
  mes: number;
  nome: string;
  de: string;
  ate: string;
  vazio: boolean;
  totalReceitas?: number;
  receitaLiquida?: number;
  margemBruta?: number;
  resultadoFinal?: number;
  custoMercadorias?: number;
  roi?: number;
  percentualMargemBruta?: number;
};

type DREAnualData = {
  ano: number;
  regime: Regime;
  meses: MesDRE[];
};

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
type TipoLinha = "grupo" | "item" | "subtotal" | "resultado";

function DRERow({
  label,
  valor,
  percentual,
  tipo,
  indent,
  sinal,
  badge,
}: {
  label: string;
  valor: number;
  percentual?: number;
  tipo: TipoLinha;
  indent?: boolean;
  sinal?: "positivo" | "negativo" | "neutro";
  badge?: React.ReactNode;
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
        <td className="py-3 pl-4 text-sm font-bold">
          <span className="flex items-center gap-2">
            {label}
            {badge}
          </span>
        </td>
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
          {badge}
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

// Selo de origem das taxas (transparência: real x estimado).
function SeloOrigemTaxas({ origem }: { origem: OrigemTaxasDre }) {
  if (origem === "nenhuma") return null;
  const cfg = {
    real: { label: "Real", cls: "border-emerald-300 text-emerald-700 dark:text-emerald-400" },
    estimado: { label: "Estimado", cls: "border-amber-300 text-amber-700 dark:text-amber-400" },
    misto: { label: "Real + Estimado", cls: "border-sky-300 text-sky-700 dark:text-sky-400" },
  }[origem];
  return (
    <Badge variant="outline" className={cn("h-4 px-1.5 text-[10px] font-medium", cfg.cls)}>
      {cfg.label}
    </Badge>
  );
}

const CORES = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function GraficoDespesas({ despesas }: { despesas: DreLinhaDespesa[] }) {
  const dados = despesas
    .filter((x) => x.valor > 0)
    .map((x) => ({ name: x.categoria.replace(/ e /g, "/"), valor: x.valor }));
  if (dados.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Despesas por Categoria</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={dados} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v) =>
                v >= 100000 ? `R$${(v / 100000).toFixed(0)}k` : formatBRL(v)
              }
              tick={{ fontSize: 10 }}
            />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(v: number) => [formatBRL(v), "Valor"]}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
              {dados.map((_, i) => (
                <Cell key={i} fill={CORES[i % CORES.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ── Visão COMPETÊNCIA ────────────────────────────────────────────────────────
function DreCompetenciaView({ d, de, ate }: { d: DRECompetenciaData; de: string; ate: string }) {
  const base = d.receitaBrutaVendas;
  const pct = (v: number) => (base > 0 ? (v / base) * 100 : 0);

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Receita Op. Líquida"
          value={formatBRL(d.receitaOperacionalLiquida)}
          sub={`${d.quantidadeVendas} pedido(s) · ${d.unidades} un.`}
          icon={DollarSign}
          color={d.receitaOperacionalLiquida >= 0 ? "green" : "red"}
          accent
          valueClassName={
            d.receitaOperacionalLiquida >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          }
        />
        <KpiCard
          label="Lucro Bruto"
          value={formatBRL(d.lucroBruto)}
          sub={`Margem bruta ${d.margemBrutaPercentual.toFixed(1)}%`}
          icon={d.lucroBruto >= 0 ? TrendingUp : TrendingDown}
          color={d.lucroBruto >= 0 ? "green" : "red"}
          accent
          valueClassName={
            d.lucroBruto >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          }
        />
        <KpiCard
          label="Lucro Operacional"
          value={formatBRL(d.lucroOperacional)}
          sub="após Ads e despesas"
          icon={d.lucroOperacional >= 0 ? TrendingUp : TrendingDown}
          color={d.lucroOperacional >= 0 ? "blue" : "red"}
          accent
          valueClassName={
            d.lucroOperacional >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          }
        />
        <KpiCard
          label="Lucro Líquido"
          value={formatBRL(d.lucroLiquido)}
          sub={`Margem líquida ${d.margemLiquidaPercentual.toFixed(1)}%`}
          icon={d.lucroLiquido >= 0 ? TrendingUp : TrendingDown}
          color={d.lucroLiquido >= 0 ? "green" : "red"}
          accent
          valueClassName={
            d.lucroLiquido >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          }
        />
      </div>

      {/* Avisos de transparência */}
      <div className="flex flex-wrap gap-2">
        {(d.origemTaxas === "estimado" || d.origemTaxas === "misto") && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
            <Info className="h-3.5 w-3.5" />
            Parte das taxas é <strong>estimada</strong> (vendas ainda não liquidadas pela Amazon).
          </div>
        )}
        {d.custoIncompleto && (
          <div className="flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            {d.vendasSemCusto} venda(s) sem custo cadastrado — CMV e lucro subestimados.
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Tabela DRE */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Demonstração do Resultado — Competência
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {de} → {ate} · por data da venda
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
                {/* RECEITA */}
                <DRERow label="Receita" valor={0} tipo="grupo" />
                <DRERow
                  label="Receita bruta de vendas"
                  valor={d.receitaBrutaVendas}
                  percentual={100}
                  tipo="item"
                  indent
                  sinal="positivo"
                />
                <DRERow
                  label="Devoluções / Reembolsos"
                  valor={d.reembolsos}
                  percentual={pct(d.reembolsos)}
                  tipo="item"
                  indent
                  sinal="negativo"
                />
                <DRERow
                  label="Receita Líquida"
                  valor={d.receitaLiquidaVendas}
                  percentual={pct(d.receitaLiquidaVendas)}
                  tipo="subtotal"
                  sinal="positivo"
                />

                {/* DEDUÇÕES */}
                <DRERow label="Deduções" valor={0} tipo="grupo" />
                <DRERow
                  label="Taxas Amazon (comissão + FBA + parcelamento)"
                  valor={d.taxasAmazon}
                  percentual={pct(d.taxasAmazon)}
                  tipo="item"
                  indent
                  sinal="negativo"
                  badge={<SeloOrigemTaxas origem={d.origemTaxas} />}
                />
                <DRERow
                  label="Fretes"
                  valor={d.fretes}
                  percentual={pct(d.fretes)}
                  tipo="item"
                  indent
                  sinal="negativo"
                />
                <DRERow
                  label="Impostos sobre vendas (Simples)"
                  valor={d.impostoSimples}
                  percentual={pct(d.impostoSimples)}
                  tipo="item"
                  indent
                  sinal="negativo"
                />
                <DRERow
                  label="Receita Operacional Líquida"
                  valor={d.receitaOperacionalLiquida}
                  percentual={pct(d.receitaOperacionalLiquida)}
                  tipo="subtotal"
                  sinal={d.receitaOperacionalLiquida >= 0 ? "positivo" : "negativo"}
                />

                {/* CMV */}
                <DRERow label="Custo das Mercadorias Vendidas" valor={0} tipo="grupo" />
                <DRERow
                  label="CMV — custo do que foi vendido"
                  valor={d.cmv}
                  percentual={pct(d.cmv)}
                  tipo="item"
                  indent
                  sinal="negativo"
                  badge={
                    d.custoIncompleto ? (
                      <Badge
                        variant="outline"
                        className="h-4 px-1.5 text-[10px] font-medium border-orange-300 text-orange-700 dark:text-orange-400"
                      >
                        incompleto
                      </Badge>
                    ) : undefined
                  }
                />
                <DRERow
                  label="Lucro Bruto"
                  valor={d.lucroBruto}
                  percentual={d.margemBrutaPercentual}
                  tipo="subtotal"
                  sinal={d.lucroBruto >= 0 ? "positivo" : "negativo"}
                />

                {/* DESPESAS */}
                <DRERow label="Despesas Operacionais" valor={0} tipo="grupo" />
                <DRERow
                  label="Publicidade (Ads)"
                  valor={d.ads}
                  percentual={pct(d.ads)}
                  tipo="item"
                  indent
                  sinal="negativo"
                />
                {d.despesasOperacionais.map((dep) => (
                  <DRERow
                    key={dep.categoria}
                    label={dep.categoria}
                    valor={dep.valor}
                    percentual={pct(dep.valor)}
                    tipo="item"
                    indent
                    sinal="negativo"
                  />
                ))}
                <DRERow
                  label="Lucro Operacional"
                  valor={d.lucroOperacional}
                  percentual={pct(d.lucroOperacional)}
                  tipo="subtotal"
                  sinal={d.lucroOperacional >= 0 ? "positivo" : "negativo"}
                />

                {/* OUTRAS (manuais) */}
                {(d.outrasReceitasManuais > 0 || d.outrasDespesasManuais > 0) && (
                  <>
                    <DRERow label="Outras (lançamentos manuais)" valor={0} tipo="grupo" />
                    {d.outrasReceitasManuais > 0 && (
                      <DRERow
                        label="Outras receitas (manuais)"
                        valor={d.outrasReceitasManuais}
                        percentual={pct(d.outrasReceitasManuais)}
                        tipo="item"
                        indent
                        sinal="positivo"
                      />
                    )}
                    {d.outrasDespesasManuais > 0 && (
                      <DRERow
                        label="Outras despesas (manuais)"
                        valor={d.outrasDespesasManuais}
                        percentual={pct(d.outrasDespesasManuais)}
                        tipo="item"
                        indent
                        sinal="negativo"
                      />
                    )}
                  </>
                )}

                {/* RESULTADO */}
                <DRERow
                  label="Lucro Líquido"
                  valor={d.lucroLiquido}
                  percentual={d.margemLiquidaPercentual}
                  tipo="resultado"
                  sinal={d.lucroLiquido >= 0 ? "positivo" : "negativo"}
                />
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Coluna direita: indicadores + gráfico */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Indicadores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {[
                {
                  label: "Margem Bruta",
                  valor: `${d.margemBrutaPercentual.toFixed(1)}%`,
                  ok: d.margemBrutaPercentual >= 30,
                },
                {
                  label: "Margem Líquida",
                  valor: `${d.margemLiquidaPercentual.toFixed(1)}%`,
                  ok: d.lucroLiquido > 0,
                },
                {
                  label: "ROI sobre CMV",
                  valor: d.cmv > 0 ? `${d.roi.toFixed(1)}%` : "—",
                  ok: d.roi >= 30,
                },
                {
                  label: "Taxas / Receita",
                  valor: base > 0 ? `${((d.taxasAmazon / base) * 100).toFixed(1)}%` : "—",
                  ok: base > 0 && d.taxasAmazon / base < 0.25,
                },
                {
                  label: "Ads / Receita (TACOS)",
                  valor: base > 0 ? `${((d.ads / base) * 100).toFixed(1)}%` : "—",
                  ok: base > 0 && d.ads / base < 0.15,
                },
                {
                  label: "Custo / Receita",
                  valor: base > 0 ? `${((d.cmv / base) * 100).toFixed(1)}%` : "—",
                  ok: base > 0 && d.cmv / base < 0.6,
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

          <GraficoDespesas despesas={d.despesasOperacionais} />

          {/* Como é calculado */}
          <Card className="border-dashed">
            <CardContent className="space-y-1.5 pt-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <Info className="h-3.5 w-3.5" /> Como este DRE é calculado
              </p>
              <p>
                Por <strong>competência</strong> (data da venda), com os dados que o sistema
                sincroniza da Amazon — sem precisar de extrato bancário. Taxas usam o valor real
                quando a Amazon já liquidou; senão, estimativa calibrada.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// ── Visão CAIXA (preservada) ─────────────────────────────────────────────────
function DreCaixaView({ d, de, ate }: { d: DRECaixaData; de: string; ate: string }) {
  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Receita Líquida"
          value={formatBRL(d.receitaLiquida)}
          sub={`${d.quantidadeLiquidacoes} liquidação(ões) Amazon`}
          icon={DollarSign}
          color={d.receitaLiquida >= 0 ? "green" : "red"}
          accent
          valueClassName={
            d.receitaLiquida >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          }
        />
        <KpiCard
          label="Margem Bruta"
          value={`${d.percentualMargemBruta.toFixed(1)}%`}
          sub={formatBRL(d.margemBruta)}
          icon={d.margemBruta >= 0 ? TrendingUp : TrendingDown}
          color={d.margemBruta >= 0 ? "green" : "red"}
          accent
          valueClassName={
            d.margemBruta >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          }
        />
        <KpiCard
          label="ROI"
          value={`${d.roi.toFixed(1)}%`}
          sub="resultado / CMV"
          icon={d.roi >= 0 ? TrendingUp : TrendingDown}
          color={d.roi >= 30 ? "green" : d.roi >= 0 ? "blue" : "red"}
          accent
          valueClassName={cn(
            d.roi >= 30 && "text-emerald-600 dark:text-emerald-400",
            d.roi < 0 && "text-destructive",
          )}
        />
        <KpiCard
          label="MPA"
          value={`${d.mpaPercentual.toFixed(1)}%`}
          sub={`Margem pós-anúncio: ${formatBRL(d.mpaValor)}`}
          icon={d.mpaPercentual >= 0 ? TrendingUp : TrendingDown}
          color={d.mpaPercentual >= 20 ? "green" : d.mpaPercentual >= 0 ? "blue" : "red"}
          accent
          valueClassName={cn(
            d.mpaPercentual >= 20 && "text-emerald-600 dark:text-emerald-400",
            d.mpaPercentual < 0 && "text-destructive",
          )}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Tabela DRE */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Demonstração do Resultado — Caixa
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {de} → {ate} · por recebimento/pagamento
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
                  label="Receita Amazon (liquidacoes)"
                  valor={d.amazon.receitaLiquidacoes}
                  percentual={d.totalReceitas > 0 ? (d.amazon.receitaLiquidacoes / d.totalReceitas) * 100 : 0}
                  tipo="item"
                  indent
                  sinal="positivo"
                />
                <DRERow
                  label="FBA Reimbursements"
                  valor={d.amazon.reimbursementsFba}
                  percentual={d.totalReceitas > 0 ? (d.amazon.reimbursementsFba / d.totalReceitas) * 100 : 0}
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
                  label="Returns FBA estimados"
                  valor={d.amazon.returnsEstimados}
                  percentual={d.totalReceitas > 0 ? (d.amazon.returnsEstimados / d.totalReceitas) * 100 : 0}
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
                  label="CMV produtos"
                  valor={d.cpv.contasPagas}
                  percentual={d.totalReceitas > 0 ? (d.cpv.contasPagas / d.totalReceitas) * 100 : 0}
                  tipo="item"
                  indent
                  sinal="negativo"
                />
                <DRERow
                  label="Storage fees FBA"
                  valor={d.amazon.storageFees}
                  percentual={d.totalReceitas > 0 ? (d.amazon.storageFees / d.totalReceitas) * 100 : 0}
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
                  percentual={d.totalReceitas > 0 ? (d.resultadoFinal / d.totalReceitas) * 100 : 0}
                  tipo="resultado"
                  sinal={d.resultadoFinal >= 0 ? "positivo" : "negativo"}
                />
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Coluna direita: indicadores + gráfico */}
        <div className="space-y-4">
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

          <GraficoDespesas despesas={d.despesasOperacionais} />

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
                {
                  label: "(-) Outros custos",
                  valor: -(d.totalDespesas - d.despesaMarketing),
                  positivo: false,
                },
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
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function DREPage() {
  const [regime, setRegime] = React.useState<Regime>("competencia");
  const [preset, setPreset] = React.useState<Preset>("mes-atual");
  const [customDe, setCustomDe] = React.useState("");
  const [customAte, setCustomAte] = React.useState("");
  const [anoAnual, setAnoAnual] = React.useState(new Date().getFullYear());

  const modoAnual = preset === "anual";

  const { de, ate } = React.useMemo(() => {
    if (preset === "custom") return { de: customDe, ate: customAte };
    if (preset === "anual") return { de: "", ate: "" };
    return getPeriodo(preset);
  }, [preset, customDe, customAte]);

  const params = new URLSearchParams();
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  params.set("regime", regime);

  const { data, isLoading } = useQuery<DREResposta>({
    queryKey: ["dre-resumo", regime, de, ate],
    queryFn: () => fetchJSON<DREResposta>(`/api/dre/resumo?${params.toString()}`),
    enabled: !modoAnual && !!de && !!ate,
  });

  const { data: dataAnual, isLoading: isLoadingAnual } = useQuery<DREAnualData>({
    queryKey: ["dre-anual", regime, anoAnual],
    queryFn: () =>
      fetchJSON<DREAnualData>(
        `/api/dre/resumo?modo=mensal&ano=${anoAnual}&regime=${regime}`,
      ),
    enabled: modoAnual,
  });

  const presets: { key: Preset; label: string }[] = [
    { key: "mes-atual", label: "Este mês" },
    { key: "mes-anterior", label: "Mês anterior" },
    { key: "trimestre", label: "Este trimestre" },
    { key: "ano", label: "Este ano" },
    { key: "anual", label: "Anual (12 meses)" },
    { key: "custom", label: "Personalizado" },
  ];

  const regimes: { key: Regime; label: string; hint: string }[] = [
    { key: "competencia", label: "Competência", hint: "Por data da venda — automático" },
    { key: "caixa", label: "Caixa", hint: "Por recebimento/pagamento — banco" },
  ];

  const d = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="DRE"
        description="Demonstração do Resultado do Exercício — visão financeira consolidada."
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="print:hidden"
          >
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Badge variant="outline" className="gap-1">
            <BarChart3 className="h-3 w-3" />
            Analítico
          </Badge>
        </div>
      </PageHeader>

      {/* Toggle de regime */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border bg-muted/30 p-0.5">
          {regimes.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRegime(r.key)}
              title={r.hint}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                regime === r.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {regime === "competencia"
            ? "Resultado por competência (data da venda) — preenchido automaticamente pelo sistema."
            : "Resultado por caixa (recebido/pago) — reflete o que entrou e saiu do banco."}
        </span>
      </div>

      {/* Seletor de período */}
      <div className="inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted/30 p-0.5">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              preset === p.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
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

      {/* Modo anual: seletor de ano + tabela comparativa */}
      {modoAnual && (
        <div className="flex items-center gap-3 print:hidden">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setAnoAnual((a) => a - 1)}
          >
            &lt;
          </Button>
          <span className="w-16 text-center text-sm font-medium">{anoAnual}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setAnoAnual((a) => a + 1)}
            disabled={anoAnual >= new Date().getFullYear()}
          >
            &gt;
          </Button>
        </div>
      )}

      {modoAnual && (isLoadingAnual ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : dataAnual ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Comparativo Mensal — {dataAnual.ano} ({regime === "competencia" ? "Competência" : "Caixa"})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="py-2.5 pl-4 text-left font-medium text-muted-foreground w-28">Métrica</th>
                  {dataAnual.meses.map((m) => (
                    <th key={m.mes} className="py-2.5 px-3 text-right font-medium text-muted-foreground min-w-[80px]">
                      {m.nome}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Receita bruta", key: "totalReceitas" as keyof MesDRE, fmt: "brl" },
                  { label: "Receita líquida", key: "receitaLiquida" as keyof MesDRE, fmt: "brl" },
                  { label: "CMV", key: "custoMercadorias" as keyof MesDRE, fmt: "brl", negativo: true },
                  { label: "Margem bruta", key: "margemBruta" as keyof MesDRE, fmt: "brl", colorir: true },
                  { label: "Margem %", key: "percentualMargemBruta" as keyof MesDRE, fmt: "pct", colorir: true },
                  { label: "Resultado", key: "resultadoFinal" as keyof MesDRE, fmt: "brl", colorir: true, negrito: true },
                  { label: "ROI", key: "roi" as keyof MesDRE, fmt: "pct", colorir: true },
                ].map((row) => (
                  <tr
                    key={row.key}
                    className={cn(
                      "border-t border-border/30 hover:bg-muted/20",
                      row.negrito && "bg-muted/30 font-semibold",
                    )}
                  >
                    <td className={cn("py-2 pl-4 text-muted-foreground", row.negrito && "font-semibold text-foreground")}>
                      {row.label}
                    </td>
                    {dataAnual.meses.map((m) => {
                      const val = m.vazio ? null : (m[row.key] as number | undefined) ?? null;
                      const texto =
                        val == null
                          ? "—"
                          : row.fmt === "brl"
                            ? formatBRL(Math.abs(val))
                            : `${val.toFixed(1)}%`;
                      const positivo = val != null && val >= 0;
                      return (
                        <td
                          key={m.mes}
                          className={cn(
                            "py-2 px-3 text-right tabular-nums",
                            val == null && "text-muted-foreground/40",
                            row.colorir && val != null && positivo && "text-emerald-600 dark:text-emerald-400",
                            row.colorir && val != null && !positivo && "text-destructive",
                          )}
                        >
                          {row.negativo && val ? `−${texto}` : texto}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null)}

      {!modoAnual && isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {!modoAnual && !isLoading && d && (
        d.regime === "competencia" ? (
          <DreCompetenciaView d={d} de={de} ate={ate} />
        ) : (
          <DreCaixaView d={d} de={de} ate={ate} />
        )
      )}

      {!modoAnual && !isLoading && !d && (
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
