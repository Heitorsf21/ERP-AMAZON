"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Banknote,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  LineChart,
  Megaphone,
  PackageSearch,
  Percent,
  PieChart,
  ReceiptText,
  Sigma,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL, parseValorBRParaCentavos } from "@/lib/money";
import {
  PeriodoPreset,
  formatarDataInputPeriodo,
  resolverPeriodo,
} from "@/lib/periodo";
import { cn } from "@/lib/utils";

type KpisDelta = {
  faturamento: number | null;
  liquidoMarketplace: number | null;
  lucroBruto: number | null;
  margem: number | null;
  numeroVendas: number | null;
  unidades: number | null;
  ticketMedio: number | null;
  roi: number | null;
  valorAds: number | null;
  tacos: number | null;
  lucroPosAds: number | null;
  roiPosAds: number | null;
};

type Kpis = {
  faturamentoCentavos: number;
  liquidoMarketplaceCentavos: number;
  lucroBrutoCentavos: number | null;
  margemPercentual: number | null;
  numeroVendas: number;
  unidades: number;
  ticketMedioCentavos: number;
  roiPercentual: number | null;
  valorAdsCentavos: number;
  tacosPercentual: number | null;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
  roiPosAdsPercentual: number | null;
  vendasSemCusto: number;
  delta: KpisDelta;
};

type TimelineItem = {
  data: string;
  faturamentoCentavos: number;
  lucroBrutoCentavos: number | null;
  lucroPosAdsCentavos: number | null;
};

type TopProduto = {
  sku: string;
  produtoId: string | null;
  nome: string;
  precoMedioCentavos: number;
  custoUnitarioCentavos: number | null;
  unidades: number;
  faturadoCentavos: number;
  representatividadePercentual: number | null;
  lucroCentavos: number | null;
  margemPercentual: number | null;
  custoAdsCentavos: number;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
};

type Produto = {
  id: string;
  sku: string;
  nome: string;
};

type AdsGastoManual = {
  id: string;
  periodoInicio: string;
  periodoFim: string;
  produtoId: string | null;
  valorCentavos: number;
  produto: Produto | null;
};

const presets = [
  { label: "Hoje", value: PeriodoPreset.HOJE },
  { label: "Ontem", value: PeriodoPreset.ONTEM },
  { label: "7d", value: PeriodoPreset.SETE_DIAS },
  { label: "15d", value: PeriodoPreset.QUINZE_DIAS },
  { label: "30d", value: PeriodoPreset.TRINTA_DIAS },
  { label: "Esse mes", value: PeriodoPreset.MES_ATUAL },
  { label: "Mes passado", value: PeriodoPreset.MES_PASSADO },
  { label: "Esse ano", value: PeriodoPreset.ANO_ATUAL },
  { label: "Personalizado", value: PeriodoPreset.PERSONALIZADO },
] as const;

function periodoInicial() {
  const periodo = resolverPeriodo(PeriodoPreset.TRINTA_DIAS);
  return {
    de: formatarDataInputPeriodo(periodo.de),
    ate: formatarDataInputPeriodo(periodo.ate),
  };
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatMoneyOrNA(value: number | null | undefined): string {
  return value == null ? "N/A" : formatBRL(value);
}

function classificarAcos(acos: number | null): { texto: string; classe: string } | null {
  if (acos == null) return null;
  if (acos < 10) return { texto: "Baixo — vale aumentar lance", classe: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" };
  if (acos < 15) return { texto: "Ótimo — manter estratégia", classe: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" };
  if (acos < 20) return { texto: "Bom — monitorar", classe: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" };
  if (acos < 25) return { texto: "Ok — avaliar ajuste", classe: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" };
  if (acos < 30) return { texto: "Atenção — reduzir lance", classe: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" };
  if (acos < 40) return { texto: "Alerta — revisar campanha", classe: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" };
  return { texto: "Crítico — pausar campanha", classe: "bg-red-800 text-white" };
}

function formatDiaCurto(value: string): string {
  const [ano, mes, dia] = value.split("-");
  return `${dia}/${mes}`;
}

function queryString(periodo: { de: string; ate: string }) {
  return new URLSearchParams(periodo).toString();
}

function DeltaBadge({
  valor,
  tipo,
  inverso = false,
}: {
  valor: number | null;
  tipo: "percent" | "pp";
  inverso?: boolean;
}) {
  if (valor == null || !Number.isFinite(valor) || Math.abs(valor) < 0.05) return null;
  const isPositive = valor > 0;
  const isGood = inverso ? !isPositive : isPositive;
  return (
    <span
      className={cn(
        "text-[11px] font-semibold tabular-nums",
        isGood
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-500 dark:text-red-400",
      )}
    >
      {isPositive ? "▲" : "▼"} {Math.abs(valor).toFixed(1)}
      {tipo === "pp" ? "pp" : "%"}
    </span>
  );
}

function KpiCard({
  titulo,
  valor,
  detalhe,
  icon: Icon,
  tone = "neutral",
  delta,
  badge,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "success" | "warning" | "danger";
  delta?: { valor: number | null; tipo: "percent" | "pp"; inverso?: boolean };
  badge?: { texto: string; classe: string } | null;
}) {
  const tones = {
    neutral: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-700 dark:text-red-400",
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {titulo}
            </p>
            <p className="mt-2 truncate text-2xl font-semibold tracking-tight tabular-nums">
              {valor}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {delta && (
                <DeltaBadge
                  valor={delta.valor}
                  tipo={delta.tipo}
                  inverso={delta.inverso}
                />
              )}
              {detalhe && (
                <p className="truncate text-xs text-muted-foreground">
                  {detalhe}
                </p>
              )}
            </div>
            {badge && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", badge.classe)}>
                  {badge.texto}
                </span>
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
              tones[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardEcommercePage() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = React.useState(periodoInicial);
  const [presetAtivo, setPresetAtivo] = React.useState<PeriodoPreset>(
    PeriodoPreset.TRINTA_DIAS,
  );
  const [sortProdutos, setSortProdutos] = React.useState<"desc" | "asc">(
    "desc",
  );
  const [produtoDetalhe, setProdutoDetalhe] = React.useState<TopProduto | null>(
    null,
  );
  const [adsForm, setAdsForm] = React.useState({
    produtoId: "",
    valor: "",
  });

  const qs = queryString(periodo);

  const { data: kpis, isLoading: loadingKpis } = useQuery<Kpis>({
    queryKey: ["dashboard-ecommerce-kpis", periodo],
    queryFn: () => fetchJSON<Kpis>(`/api/dashboard-ecommerce/kpis?${qs}`),
  });

  const { data: timeline = [] } = useQuery<TimelineItem[]>({
    queryKey: ["dashboard-ecommerce-timeline", periodo],
    queryFn: () =>
      fetchJSON<TimelineItem[]>(`/api/dashboard-ecommerce/timeline?${qs}`),
  });

  const { data: topProdutos = [], isLoading: loadingTop } = useQuery<
    TopProduto[]
  >({
    queryKey: ["dashboard-ecommerce-top-produtos", periodo],
    queryFn: () =>
      fetchJSON<TopProduto[]>(
        `/api/dashboard-ecommerce/top-produtos?${qs}&limit=15`,
      ),
  });

  const { data: produtos = [] } = useQuery<Produto[]>({
    queryKey: ["estoque-produtos", "ads-form"],
    queryFn: () => fetchJSON<Produto[]>("/api/estoque/produtos"),
  });

  const { data: gastosAds = [] } = useQuery<AdsGastoManual[]>({
    queryKey: ["ads-gasto-manual", periodo],
    queryFn: () => fetchJSON<AdsGastoManual[]>(`/api/ads/gasto-manual?${qs}`),
  });

  const criarAds = useMutation({
    mutationFn: (payload: {
      produtoId: string | null;
      valorCentavos: number;
      periodoInicio: string;
      periodoFim: string;
    }) =>
      fetchJSON("/api/ads/gasto-manual", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setAdsForm({ produtoId: "", valor: "" });
      qc.invalidateQueries({ queryKey: ["ads-gasto-manual"] });
      qc.invalidateQueries({ queryKey: ["dashboard-ecommerce-kpis"] });
      qc.invalidateQueries({ queryKey: ["dashboard-ecommerce-timeline"] });
      qc.invalidateQueries({ queryKey: ["dashboard-ecommerce-top-produtos"] });
      toast.success("Gasto de Ads salvo");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const produtosOrdenados = React.useMemo(() => {
    return [...topProdutos].sort((a, b) =>
      sortProdutos === "desc"
        ? b.faturadoCentavos - a.faturadoCentavos
        : a.faturadoCentavos - b.faturadoCentavos,
    );
  }, [topProdutos, sortProdutos]);

  const d = kpis?.delta;
  const cards = [
    {
      titulo: "Faturamento",
      valor: formatBRL(kpis?.faturamentoCentavos ?? 0),
      icon: CircleDollarSign,
      tone: "success" as const,
      delta: { valor: d?.faturamento ?? null, tipo: "percent" as const },
    },
    {
      titulo: "Liq. Marketplace",
      valor: formatBRL(kpis?.liquidoMarketplaceCentavos ?? 0),
      icon: Banknote,
      delta: { valor: d?.liquidoMarketplace ?? null, tipo: "percent" as const },
    },
    {
      titulo: "Lucro Bruto",
      valor: loadingKpis ? "..." : formatMoneyOrNA(kpis?.lucroBrutoCentavos),
      icon: TrendingUp,
      tone: "success" as const,
      delta: { valor: d?.lucroBruto ?? null, tipo: "percent" as const },
    },
    {
      titulo: "Margem",
      valor: loadingKpis ? "..." : formatPercent(kpis?.margemPercentual),
      icon: Percent,
      delta: { valor: d?.margem ?? null, tipo: "pp" as const },
    },
    {
      titulo: "Vendas",
      valor: String(kpis?.numeroVendas ?? 0),
      icon: ReceiptText,
      delta: { valor: d?.numeroVendas ?? null, tipo: "percent" as const },
    },
    {
      titulo: "Unidades",
      valor: String(kpis?.unidades ?? 0),
      icon: Boxes,
      delta: { valor: d?.unidades ?? null, tipo: "percent" as const },
    },
    {
      titulo: "Ticket Medio",
      valor: formatBRL(kpis?.ticketMedioCentavos ?? 0),
      icon: Sigma,
      delta: { valor: d?.ticketMedio ?? null, tipo: "percent" as const },
    },
    {
      titulo: "ROI",
      valor: loadingKpis ? "..." : formatPercent(kpis?.roiPercentual),
      icon: Target,
      delta: { valor: d?.roi ?? null, tipo: "pp" as const },
    },
    {
      titulo: "Valor em Ads",
      valor: formatBRL(kpis?.valorAdsCentavos ?? 0),
      icon: Megaphone,
      tone: "warning" as const,
      delta: { valor: d?.valorAds ?? null, tipo: "percent" as const, inverso: true },
    },
    {
      titulo: "TACOS",
      valor: loadingKpis ? "..." : formatPercent(kpis?.tacosPercentual),
      icon: PieChart,
      tone: "warning" as const,
      delta: { valor: d?.tacos ?? null, tipo: "pp" as const, inverso: true },
      badge: classificarAcos(kpis?.tacosPercentual ?? null),
    },
    {
      titulo: "Lucro pos Ads",
      valor: loadingKpis ? "..." : formatMoneyOrNA(kpis?.lucroPosAdsCentavos),
      detalhe: `MPA ${formatPercent(kpis?.mpaPercentual)}`,
      icon: LineChart,
      tone:
        (kpis?.lucroPosAdsCentavos ?? 0) < 0 ? ("danger" as const) : ("success" as const),
      delta: { valor: d?.lucroPosAds ?? null, tipo: "percent" as const },
    },
    {
      titulo: "ROI pos Ads",
      valor: loadingKpis ? "..." : formatPercent(kpis?.roiPosAdsPercentual),
      icon: BarChart3,
      delta: { valor: d?.roiPosAds ?? null, tipo: "pp" as const },
    },
  ];

  function aplicarPreset(value: PeriodoPreset) {
    setPresetAtivo(value);
    if (value === PeriodoPreset.PERSONALIZADO) return;

    const resolvido = resolverPeriodo(value);
    setPeriodo({
      de: formatarDataInputPeriodo(resolvido.de),
      ate: formatarDataInputPeriodo(resolvido.ate),
    });
  }

  function salvarAds(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    let valorCentavos: number;

    try {
      valorCentavos = parseValorBRParaCentavos(adsForm.valor);
    } catch {
      toast.error("Informe um valor de Ads valido");
      return;
    }

    criarAds.mutate({
      produtoId: adsForm.produtoId || null,
      valorCentavos,
      periodoInicio: periodo.de,
      periodoFim: periodo.ate,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard E-commerce"
        description="KPIs comerciais da Amazon por vendas item-a-item."
      />

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              type="button"
              size="sm"
              variant={presetAtivo === preset.value ? "default" : "ghost"}
              onClick={() => aplicarPreset(preset.value)}
              className="h-8"
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={periodo.de}
              onChange={(e) => {
                setPresetAtivo(PeriodoPreset.PERSONALIZADO);
                setPeriodo((prev) => ({ ...prev, de: e.target.value }));
              }}
              className="h-8 w-[140px]"
            />
          </div>
          <Input
            type="date"
            value={periodo.ate}
            onChange={(e) => {
              setPresetAtivo(PeriodoPreset.PERSONALIZADO);
              setPeriodo((prev) => ({ ...prev, ate: e.target.value }));
            }}
            className="h-8 w-[140px]"
          />
        </div>
      </div>

      {kpis && kpis.vendasSemCusto > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/50 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <span className="text-amber-800 dark:text-amber-200">
            <strong>{kpis.vendasSemCusto} venda(s)</strong> sem custo cadastrado — lucro e margem podem estar incorretos.
          </span>
          <Link
            href="/estoque"
            className="ml-auto shrink-0 text-xs font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-amber-400"
          >
            Corrigir custos →
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
        {cards.map((card) => (
          <KpiCard key={card.titulo} {...card} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Faturamento diario</CardTitle>
            <Badge variant="secondary">recharts</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={timeline}
                  margin={{ top: 8, right: 14, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="receita" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.26} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="data"
                    tickFormatter={formatDiaCurto}
                    minTickGap={22}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                  />
                  <YAxis
                    tickFormatter={(value) => formatBRL(Number(value))}
                    width={78}
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatBRL(Number(value)),
                      name === "faturamentoCentavos"
                        ? "Faturamento"
                        : name === "lucroBrutoCentavos"
                          ? "Lucro bruto"
                          : "Lucro pos Ads",
                    ]}
                    labelFormatter={(value) => formatDiaCurto(String(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="faturamentoCentavos"
                    stroke="#059669"
                    strokeWidth={2}
                    fill="url(#receita)"
                    dot={false}
                    name="Faturamento"
                  />
                  <Line
                    type="monotone"
                    dataKey="lucroBrutoCentavos"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name="Lucro bruto"
                  />
                  <Line
                    type="monotone"
                    dataKey="lucroPosAdsCentavos"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name="Lucro pos Ads"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ads manual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={salvarAds}>
              <div className="space-y-1.5">
                <Label htmlFor="adsProduto">Produto</Label>
                <Select
                  id="adsProduto"
                  value={adsForm.produtoId}
                  onChange={(e) =>
                    setAdsForm((prev) => ({
                      ...prev,
                      produtoId: e.target.value,
                    }))
                  }
                >
                  <option value="">Geral</option>
                  {produtos.map((produto) => (
                    <option key={produto.id} value={produto.id}>
                      {produto.sku} - {produto.nome}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adsValor">Valor</Label>
                <Input
                  id="adsValor"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={adsForm.valor}
                  onChange={(e) =>
                    setAdsForm((prev) => ({ ...prev, valor: e.target.value }))
                  }
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={criarAds.isPending}
              >
                {criarAds.isPending ? "Salvando..." : "Salvar gasto"}
              </Button>
            </form>

            <div className="space-y-2">
              {gastosAds.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Sem gasto manual no periodo.
                </p>
              ) : (
                gastosAds.slice(0, 5).map((gasto) => (
                  <div
                    key={gasto.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {gasto.produto
                          ? `${gasto.produto.sku} - ${gasto.produto.nome}`
                          : "Geral"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(gasto.periodoInicio).toLocaleDateString(
                          "pt-BR",
                        )}{" "}
                        -{" "}
                        {new Date(gasto.periodoFim).toLocaleDateString(
                          "pt-BR",
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono font-semibold">
                      {formatBRL(gasto.valorCentavos)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Top 15 produtos</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSortProdutos((sort) => (sort === "desc" ? "asc" : "desc"))
            }
          >
            <ArrowUpDown className="mr-2 h-4 w-4" />
            Faturamento {sortProdutos === "desc" ? "desc" : "asc"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">Produto</TableHead>
                  <TableHead className="text-right">Preco medio</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Unid.</TableHead>
                  <TableHead className="text-right">Faturado</TableHead>
                  <TableHead className="text-right">Represent.</TableHead>
                  <TableHead className="text-right">Lucro</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead className="text-right">Custo ADS</TableHead>
                  <TableHead className="text-right">Lucro pos Ads</TableHead>
                  <TableHead className="text-right">MPA</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTop ? (
                  <TableRow>
                    <TableCell
                      colSpan={12}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Carregando produtos...
                    </TableCell>
                  </TableRow>
                ) : produtosOrdenados.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={12}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Sem vendas no periodo.
                    </TableCell>
                  </TableRow>
                ) : (
                  produtosOrdenados.map((produto) => (
                    <TableRow key={produto.sku} className="even:bg-muted/30">
                      <TableCell>
                        <div className="max-w-[320px]">
                          <p className="truncate font-medium">{produto.nome}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {produto.sku}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatBRL(produto.precoMedioCentavos)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoneyOrNA(produto.custoUnitarioCentavos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {produto.unidades}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {formatBRL(produto.faturadoCentavos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(produto.representatividadePercentual)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoneyOrNA(produto.lucroCentavos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(produto.margemPercentual)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatBRL(produto.custoAdsCentavos)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoneyOrNA(produto.lucroPosAdsCentavos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(produto.mpaPercentual)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setProdutoDetalhe(produto)}
                          title="Detalhe do produto"
                        >
                          <PackageSearch className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!produtoDetalhe}
        onOpenChange={(open) => !open && setProdutoDetalhe(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{produtoDetalhe?.nome ?? "Detalhe"}</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-dashed p-8 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 font-medium">Grafico por SKU em breve</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {produtoDetalhe?.sku}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
