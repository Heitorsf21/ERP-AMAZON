"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpDown,
  Award,
  BarChart3,
  Banknote,
  Boxes,
  Calendar,
  ChevronDown,
  CircleDollarSign,
  Info,
  Landmark,
  LineChart,
  Megaphone,
  MousePointerClick,
  PackageSearch,
  Percent,
  PieChart,
  ReceiptText,
  ShoppingCart,
  Sigma,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarginBadge } from "@/components/ui/margin-badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProductThumb } from "@/components/ui/product-thumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendIndicator } from "@/components/ui/trend-indicator";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import {
  PeriodoPreset,
  formatarDataInputPeriodo,
  resolverPeriodo,
} from "@/lib/periodo";
import { cn } from "@/lib/utils";

type KpisDelta = {
  faturamento: number | null;
  frete: number | null;
  faturamentoComFrete: number | null;
  faturamentoReembolsado: number | null;
  faturamentoComReembolsados: number | null;
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
  freteCentavos: number;
  faturamentoComFreteCentavos: number;
  faturamentoReembolsadoCentavos: number;
  faturamentoComReembolsadosCentavos: number;
  liquidoMarketplaceCentavos: number;
  impostoSimplesCentavos: number;
  impostoSimplesAliquotaBps: number;
  impostoSimplesAtivo: boolean;
  lucroBrutoCentavos: number | null;
  margemPercentual: number | null;
  numeroVendas: number;
  unidades: number;
  ticketMedioCentavos: number;
  roiPercentual: number | null;
  valorAdsCentavos: number;
  valorAdsFonte?: string;
  valorAdsParcial?: boolean;
  tacosPercentual: number | null;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
  roiPosAdsPercentual: number | null;
  trafficSessions: number;
  trafficPageViews: number;
  trafficUnitsOrdered: number;
  trafficRevenueOrderedCentavos: number;
  trafficConversionPercent: number | null;
  trafficBuyBoxPercent: number | null;
  vendasSemCusto: number;
  vendasComTaxaEstimada?: number;
  categoriasTaxaEstimada?: Array<{
    slug: string | null;
    label: string;
    regra: string;
    vendas: number;
  }>;
  origemTaxas?: "real" | "estimado" | "misto" | "nenhuma";
  delta: KpisDelta;
};

type TimelineItem = {
  data: string;
  faturamentoCentavos: number;
  liquidoMarketplaceCentavos: number;
  impostoSimplesCentavos: number;
  lucroBrutoCentavos: number | null;
  lucroPosAdsCentavos: number | null;
};

type TopProduto = {
  sku: string;
  produtoId: string | null;
  nome: string;
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
  asin: string | null;
  precoMedioCentavos: number;
  custoUnitarioCentavos: number | null;
  unidades: number;
  faturadoCentavos: number;
  representatividadePercentual: number | null;
  lucroCentavos: number | null;
  impostoSimplesCentavos: number;
  margemPercentual: number | null;
  custoAdsCentavos: number;
  lucroPosAdsCentavos: number | null;
  mpaPercentual: number | null;
};

const presets = [
  { label: "Hoje", value: PeriodoPreset.HOJE },
  { label: "Ontem", value: PeriodoPreset.ONTEM },
  { label: "Ultimos 7 dias", value: PeriodoPreset.SETE_DIAS },
  { label: "Ultimos 15 dias", value: PeriodoPreset.QUINZE_DIAS },
  { label: "Ultimos 30 dias", value: PeriodoPreset.TRINTA_DIAS },
  { label: "Mes atual", value: PeriodoPreset.MES_ATUAL },
  { label: "Mes anterior", value: PeriodoPreset.MES_PASSADO },
  { label: "Ano atual", value: PeriodoPreset.ANO_ATUAL },
  { label: "Personalizado", value: PeriodoPreset.PERSONALIZADO },
] as const;

function formatPeriodoBR(value: string): string {
  const [ano, mes, dia] = value.split("-");
  return `${dia}/${mes}/${ano}`;
}

function periodoInicial() {
  const periodo = resolverPeriodo(PeriodoPreset.TRINTA_DIAS);
  return {
    de: formatarDataInputPeriodo(periodo.de),
    ate: formatarDataInputPeriodo(periodo.ate),
  };
}

const PRESET_VALUES = new Set<string>(Object.values(PeriodoPreset));

function lerEstadoInicialDaURL(searchParams: URLSearchParams) {
  const presetParam = searchParams.get("preset");
  const deParam = searchParams.get("de");
  const ateParam = searchParams.get("ate");

  if (presetParam === PeriodoPreset.PERSONALIZADO && deParam && ateParam) {
    return {
      preset: PeriodoPreset.PERSONALIZADO as PeriodoPreset,
      periodo: { de: deParam, ate: ateParam },
    };
  }

  if (presetParam && PRESET_VALUES.has(presetParam)) {
    const preset = presetParam as PeriodoPreset;
    if (preset === PeriodoPreset.PERSONALIZADO) {
      return { preset, periodo: periodoInicial() };
    }
    const intervalo = resolverPeriodo(preset);
    return {
      preset,
      periodo: {
        de: formatarDataInputPeriodo(intervalo.de),
        ate: formatarDataInputPeriodo(intervalo.ate),
      },
    };
  }

  if (deParam && ateParam) {
    return {
      preset: PeriodoPreset.PERSONALIZADO as PeriodoPreset,
      periodo: { de: deParam, ate: ateParam },
    };
  }

  return {
    preset: PeriodoPreset.TRINTA_DIAS as PeriodoPreset,
    periodo: periodoInicial(),
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

function formatInt(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("pt-BR");
}

function classificarAcos(acos: number | null): { texto: string; classe: string } | null {
  if (acos == null) return null;
  if (acos < 10) return { texto: "Baixo — vale aumentar lance", classe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" };
  if (acos < 15) return { texto: "Ótimo — manter estratégia", classe: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" };
  if (acos < 20) return { texto: "Bom — monitorar", classe: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400" };
  if (acos < 25) return { texto: "Ok — avaliar ajuste", classe: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-300" };
  if (acos < 30) return { texto: "Atenção — reduzir lance", classe: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" };
  if (acos < 40) return { texto: "Alerta — revisar campanha", classe: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" };
  return { texto: "Crítico — pausar campanha", classe: "bg-red-700 text-white" };
}

function formatDiaCurto(value: string): string {
  const [, mes, dia] = value.split("-");
  return `${dia}/${mes}`;
}

function queryString(periodo: { de: string; ate: string }) {
  return new URLSearchParams(periodo).toString();
}

type CategoriaKpi = "receita" | "operacao" | "ads" | "trafego" | "imposto";

const categoriaConfig: Record<
  CategoriaKpi,
  { bar: string; iconBg: string; iconText: string }
> = {
  receita: {
    bar: "bg-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-600 dark:text-emerald-400",
  },
  operacao: {
    bar: "bg-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-600 dark:text-blue-400",
  },
  ads: {
    bar: "bg-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
  },
  trafego: {
    bar: "bg-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-600 dark:text-violet-400",
  },
  imposto: {
    bar: "bg-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-600 dark:text-rose-400",
  },
};

type KpiCardProps = {
  titulo: string;
  valor: string;
  detalhe?: string;
  icon: React.ComponentType<{ className?: string }>;
  categoria: CategoriaKpi;
  delta?: { valor: number | null; tipo: "percent" | "pp"; inverso?: boolean };
  badge?: { texto: string; classe: string } | null;
  tooltip?: Array<{ label: string; value: string }>;
  size?: "hero" | "medium" | "compact";
};

function KpiCard({
  titulo,
  valor,
  detalhe,
  icon: Icon,
  categoria,
  delta,
  badge,
  tooltip,
  size = "hero",
}: KpiCardProps) {
  const c = categoriaConfig[categoria];
  const padding = size === "compact" ? "p-3.5" : size === "medium" ? "p-4" : "p-5";
  const valorClasse =
    size === "compact"
      ? "text-base"
      : size === "medium"
        ? "text-xl"
        : "text-2xl xl:text-3xl";
  const iconBox =
    size === "compact" ? "h-7 w-7" : size === "medium" ? "h-8 w-8" : "h-9 w-9";
  const iconClasse = size === "compact" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 bottom-0 w-1", c.bar)}
      />
      <CardContent className={padding}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <p
                className="min-w-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground line-clamp-1"
                title={titulo}
              >
                {titulo}
              </p>
              {tooltip && tooltip.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Detalhes de ${titulo}`}
                      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-3">
                    <div className="space-y-1.5">
                      {tooltip.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-4 text-xs"
                        >
                          <span className="text-muted-foreground">{item.label}</span>
                          <span className="font-medium tabular-nums">{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <p
              className={cn(
                "mt-1.5 font-bold leading-tight tracking-tight tabular-nums break-words",
                valorClasse,
                valor === "N/A" && "text-muted-foreground/50",
              )}
              title={valor}
            >
              {valor}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {delta && (
                <TrendIndicator
                  value={delta.valor}
                  unit={delta.tipo}
                  inverso={delta.inverso}
                />
              )}
              {detalhe && (
                <p className="text-xs text-muted-foreground" title={detalhe}>
                  {detalhe}
                </p>
              )}
            </div>
            {badge && (
              <div className="mt-2 flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    badge.classe,
                  )}
                >
                  {badge.texto}
                </span>
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md",
              iconBox,
              c.iconBg,
              c.iconText,
            )}
          >
            <Icon className={iconClasse} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardEcommerceContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const estadoInicial = React.useMemo(
    () => lerEstadoInicialDaURL(new URLSearchParams(searchParams.toString())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [periodo, setPeriodo] = React.useState(estadoInicial.periodo);
  const [presetAtivo, setPresetAtivo] = React.useState<PeriodoPreset>(
    estadoInicial.preset,
  );
  const [periodoPopoverAberto, setPeriodoPopoverAberto] = React.useState(false);
  const [personalizadoRascunho, setPersonalizadoRascunho] = React.useState(
    estadoInicial.periodo,
  );
  const [sortProdutos, setSortProdutos] = React.useState<"desc" | "asc">("desc");
  const [produtoDetalhe, setProdutoDetalhe] = React.useState<TopProduto | null>(
    null,
  );
  const [mostrarSecundarios, setMostrarSecundarios] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams();
    params.set("preset", presetAtivo);
    if (presetAtivo === PeriodoPreset.PERSONALIZADO) {
      params.set("de", periodo.de);
      params.set("ate", periodo.ate);
    }
    const novaQuery = params.toString();
    const atual = searchParams.toString();
    if (novaQuery !== atual) {
      router.replace(`${pathname}?${novaQuery}` as never, { scroll: false });
    }
  }, [presetAtivo, periodo, pathname, router, searchParams]);

  const qs = queryString(periodo);

  const presetSelecionado = presets.find((p) => p.value === presetAtivo);
  const labelBotaoPeriodo =
    presetAtivo === PeriodoPreset.PERSONALIZADO
      ? `${formatPeriodoBR(periodo.de)} - ${formatPeriodoBR(periodo.ate)}`
      : (presetSelecionado?.label ?? "Periodo");

  const { data: kpis, isLoading: loadingKpis } = useQuery<Kpis>({
    queryKey: ["dashboard-ecommerce-kpis", periodo],
    queryFn: () => fetchJSON<Kpis>(`/api/dashboard-ecommerce/kpis?${qs}`),
  });

  const { data: timeline = [] } = useQuery<TimelineItem[]>({
    queryKey: ["dashboard-ecommerce-timeline", periodo],
    queryFn: () =>
      fetchJSON<TimelineItem[]>(`/api/dashboard-ecommerce/timeline?${qs}`),
  });

  const { data: topProdutos = [], isLoading: loadingTop } = useQuery<TopProduto[]>({
    queryKey: ["dashboard-ecommerce-top-produtos", periodo],
    queryFn: () =>
      fetchJSON<TopProduto[]>(
        `/api/dashboard-ecommerce/top-produtos?${qs}&limit=15`,
      ),
  });

  const produtosOrdenados = React.useMemo(() => {
    return [...topProdutos].sort((a, b) =>
      sortProdutos === "desc"
        ? b.faturadoCentavos - a.faturadoCentavos
        : a.faturadoCentavos - b.faturadoCentavos,
    );
  }, [topProdutos, sortProdutos]);

  const d = kpis?.delta;

  const formatBpsToPercent = (bps: number) =>
    Number.isInteger(bps / 100) ? `${bps / 100}%` : `${(bps / 100).toFixed(2)}%`;
  const aliquotaLabel = kpis?.impostoSimplesAtivo
    ? formatBpsToPercent(kpis?.impostoSimplesAliquotaBps ?? 600)
    : "desativado";
  const lucroLiquidoDetalhe = kpis?.impostoSimplesAtivo
    ? `Liquido de Simples ${aliquotaLabel}`
    : "Simples desativado nas configuracoes";

  const kpisPrincipais: KpiCardProps[] = [
    {
      titulo: "Faturamento",
      valor: formatBRL(kpis?.faturamentoCentavos ?? 0),
      icon: CircleDollarSign,
      categoria: "receita",
      size: "hero",
      delta: { valor: d?.faturamento ?? null, tipo: "percent" },
      tooltip: [
        { label: "Total do frete", value: formatBRL(kpis?.freteCentavos ?? 0) },
        {
          label: "Total com frete",
          value: formatBRL(kpis?.faturamentoComFreteCentavos ?? 0),
        },
        {
          label: "Fat. reembolsados",
          value: formatBRL(kpis?.faturamentoReembolsadoCentavos ?? 0),
        },
        {
          label: "Total c/ reembolsados",
          value: formatBRL(kpis?.faturamentoComReembolsadosCentavos ?? 0),
        },
      ],
    },
    {
      titulo: "Liq. Marketplace",
      valor: formatBRL(kpis?.liquidoMarketplaceCentavos ?? 0),
      icon: Banknote,
      categoria: "receita",
      size: "hero",
      delta: { valor: d?.liquidoMarketplace ?? null, tipo: "percent" },
    },
    {
      titulo: "Lucro Bruto",
      valor: loadingKpis ? "..." : formatMoneyOrNA(kpis?.lucroBrutoCentavos),
      icon: TrendingUp,
      categoria: "operacao",
      size: "hero",
      delta: { valor: d?.lucroBruto ?? null, tipo: "percent" },
      detalhe:
        kpis?.lucroBrutoCentavos == null
          ? "aguardando custos"
          : lucroLiquidoDetalhe,
      tooltip: [
        {
          label: "Imposto Simples deduzido",
          value: formatBRL(kpis?.impostoSimplesCentavos ?? 0),
        },
        { label: "Aliquota", value: aliquotaLabel },
      ],
    },
    {
      titulo: "Margem",
      valor: loadingKpis ? "..." : formatPercent(kpis?.margemPercentual),
      icon: Percent,
      categoria: "operacao",
      size: "hero",
      delta: { valor: d?.margem ?? null, tipo: "pp" },
      detalhe:
        kpis?.margemPercentual == null
          ? "aguardando custos"
          : lucroLiquidoDetalhe,
    },
    {
      titulo: "Vendas",
      valor: formatInt(kpis?.numeroVendas),
      icon: ReceiptText,
      categoria: "operacao",
      size: "medium",
      delta: { valor: d?.numeroVendas ?? null, tipo: "percent" },
    },
    {
      titulo: "Unidades",
      valor: formatInt(kpis?.unidades),
      icon: Boxes,
      categoria: "operacao",
      size: "medium",
      delta: { valor: d?.unidades ?? null, tipo: "percent" },
    },
    {
      titulo: "Ticket Medio",
      valor: formatBRL(kpis?.ticketMedioCentavos ?? 0),
      icon: Sigma,
      categoria: "operacao",
      size: "medium",
      delta: { valor: d?.ticketMedio ?? null, tipo: "percent" },
    },
    {
      titulo: "ROI",
      valor: loadingKpis ? "..." : formatPercent(kpis?.roiPercentual),
      icon: Target,
      categoria: "operacao",
      size: "medium",
      delta: { valor: d?.roi ?? null, tipo: "pp" },
      detalhe:
        kpis?.roiPercentual == null ? "aguardando custos" : lucroLiquidoDetalhe,
    },
  ];

  const kpisSecundarios: KpiCardProps[] = [
    {
      titulo: "Imposto Simples",
      valor: formatBRL(kpis?.impostoSimplesCentavos ?? 0),
      icon: Landmark,
      categoria: "imposto",
      size: "compact",
      detalhe: aliquotaLabel,
    },
    {
      titulo: "Valor em Ads",
      valor: formatBRL(kpis?.valorAdsCentavos ?? 0),
      icon: Megaphone,
      categoria: "ads",
      size: "compact",
      delta: { valor: d?.valorAds ?? null, tipo: "percent", inverso: true },
      badge: kpis?.valorAdsParcial
        ? {
            texto: "Parcial",
            classe:
              "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200",
          }
        : null,
    },
    {
      titulo: "TACOS",
      valor: loadingKpis ? "..." : formatPercent(kpis?.tacosPercentual),
      icon: PieChart,
      categoria: "ads",
      size: "compact",
      delta: { valor: d?.tacos ?? null, tipo: "pp", inverso: true },
      badge: classificarAcos(kpis?.tacosPercentual ?? null),
    },
    {
      titulo: "Lucro pos Ads",
      valor: loadingKpis ? "..." : formatMoneyOrNA(kpis?.lucroPosAdsCentavos),
      icon: LineChart,
      categoria: "ads",
      size: "compact",
      delta: { valor: d?.lucroPosAds ?? null, tipo: "percent" },
      detalhe:
        kpis?.lucroPosAdsCentavos == null
          ? "aguardando custos"
          : `MPA ${formatPercent(kpis?.mpaPercentual)}`,
      tooltip: [
        {
          label: "Imposto Simples deduzido",
          value: formatBRL(kpis?.impostoSimplesCentavos ?? 0),
        },
        { label: "Aliquota", value: aliquotaLabel },
      ],
    },
    {
      titulo: "ROI pos Ads",
      valor: loadingKpis ? "..." : formatPercent(kpis?.roiPosAdsPercentual),
      icon: BarChart3,
      categoria: "ads",
      size: "compact",
      delta: { valor: d?.roiPosAds ?? null, tipo: "pp" },
      detalhe:
        kpis?.roiPosAdsPercentual == null
          ? "aguardando custos"
          : lucroLiquidoDetalhe,
    },
    {
      titulo: "Sessoes",
      valor: loadingKpis ? "..." : formatInt(kpis?.trafficSessions),
      icon: Zap,
      categoria: "trafego",
      size: "compact",
      detalhe: `${formatInt(kpis?.trafficPageViews)} page views`,
    },
    {
      titulo: "Conversao",
      valor: loadingKpis ? "..." : formatPercent(kpis?.trafficConversionPercent),
      icon: MousePointerClick,
      categoria: "trafego",
      size: "compact",
      detalhe: `${formatInt(kpis?.trafficUnitsOrdered)} unidades ordenadas`,
    },
    {
      titulo: "Buybox media",
      valor: loadingKpis ? "..." : formatPercent(kpis?.trafficBuyBoxPercent),
      icon: Award,
      categoria: "trafego",
      size: "compact",
      detalhe: "media por SKU/dia",
    },
    {
      titulo: "Receita ordenada",
      valor: loadingKpis
        ? "..."
        : formatBRL(kpis?.trafficRevenueOrderedCentavos ?? 0),
      icon: ShoppingCart,
      categoria: "trafego",
      size: "compact",
      detalhe: "Sales & Traffic",
    },
  ];

  function aplicarPreset(value: PeriodoPreset) {
    setPresetAtivo(value);
    if (value === PeriodoPreset.PERSONALIZADO) {
      setPersonalizadoRascunho(periodo);
      return;
    }

    const resolvido = resolverPeriodo(value);
    const novo = {
      de: formatarDataInputPeriodo(resolvido.de),
      ate: formatarDataInputPeriodo(resolvido.ate),
    };
    setPeriodo(novo);
    setPersonalizadoRascunho(novo);
    setPeriodoPopoverAberto(false);
  }

  function aplicarPersonalizado() {
    if (!personalizadoRascunho.de || !personalizadoRascunho.ate) {
      toast.error("Informe data inicial e final");
      return;
    }
    if (personalizadoRascunho.de > personalizadoRascunho.ate) {
      toast.error("Data inicial deve ser anterior a final");
      return;
    }
    setPresetAtivo(PeriodoPreset.PERSONALIZADO);
    setPeriodo(personalizadoRascunho);
    setPeriodoPopoverAberto(false);
  }

  const heroes = kpisPrincipais.slice(0, 4);
  const medios = kpisPrincipais.slice(4, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard E-commerce"
        description={`KPIs comerciais da Amazon · vendas item-a-item · ${formatPeriodoBR(periodo.de)} — ${formatPeriodoBR(periodo.ate)}`}
      >
        <Popover
          open={periodoPopoverAberto}
          onOpenChange={(open) => {
            setPeriodoPopoverAberto(open);
            if (open) setPersonalizadoRascunho(periodo);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-2"
            >
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{labelBotaoPeriodo}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <div className="flex flex-col">
              {presets.map((preset) => {
                const ativo = presetAtivo === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => aplicarPreset(preset.value)}
                    className={cn(
                      "flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                      ativo
                        ? "bg-primary/10 font-semibold text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <span>{preset.label}</span>
                    {ativo && preset.value !== PeriodoPreset.PERSONALIZADO && (
                      <span className="text-[11px] text-muted-foreground">
                        Atual
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {presetAtivo === PeriodoPreset.PERSONALIZADO && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="periodo-de"
                      className="text-[11px] text-muted-foreground"
                    >
                      De
                    </Label>
                    <Input
                      id="periodo-de"
                      type="date"
                      value={personalizadoRascunho.de}
                      onChange={(e) =>
                        setPersonalizadoRascunho((prev) => ({
                          ...prev,
                          de: e.target.value,
                        }))
                      }
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="periodo-ate"
                      className="text-[11px] text-muted-foreground"
                    >
                      Ate
                    </Label>
                    <Input
                      id="periodo-ate"
                      type="date"
                      value={personalizadoRascunho.ate}
                      onChange={(e) =>
                        setPersonalizadoRascunho((prev) => ({
                          ...prev,
                          ate: e.target.value,
                        }))
                      }
                      className="h-8"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={aplicarPersonalizado}
                >
                  Aplicar periodo
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </PageHeader>

      {kpis && kpis.vendasSemCusto > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/50 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <span className="text-amber-800 dark:text-amber-200">
            <strong>{kpis.vendasSemCusto} venda(s)</strong> sem custo cadastrado — lucro e margem podem estar incorretos.
          </span>
          <Link
            href="/produtos"
            className="ml-auto shrink-0 text-xs font-semibold text-amber-700 underline-offset-4 hover:underline dark:text-amber-400"
          >
            Corrigir custos →
          </Link>
        </div>
      )}

      {kpis && (kpis.vendasComTaxaEstimada ?? 0) > 0 && (
        <div
          className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-sky-800/50 dark:bg-sky-900/20"
          title="Pedidos PENDENTE ainda não settled pela Amazon. Taxas reais (Comissão + FBA + parcelamento) entram quando Finance Events publica."
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-500" />
          <div className="text-sky-800 dark:text-sky-200">
            <strong>{kpis.vendasComTaxaEstimada} venda(s)</strong> com taxa Amazon <em>estimada</em> (pedidos PENDENTE — settle em até 7 dias).
            {(kpis.categoriasTaxaEstimada?.length ?? 0) > 0 && (
              <div className="mt-1 text-xs">
                {kpis.categoriasTaxaEstimada
                  ?.slice(0, 4)
                  .map((c) => `${c.label} ${c.regra} (${c.vendas})`)
                  .join(" · ")}
                {(kpis.categoriasTaxaEstimada?.length ?? 0) > 4
                  ? ` · +${(kpis.categoriasTaxaEstimada?.length ?? 0) - 4}`
                  : ""}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {heroes.map((card) => (
          <KpiCard key={card.titulo} {...card} />
        ))}
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {medios.map((card) => (
          <KpiCard key={card.titulo} {...card} />
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setMostrarSecundarios((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              mostrarSecundarios && "rotate-180",
            )}
          />
          {mostrarSecundarios
            ? "Ocultar metricas secundarias"
            : "Ver mais 8 metricas (Ads · Trafego)"}
        </button>
        {mostrarSecundarios && (
          <div className="mt-4 grid gap-3 grid-cols-2 lg:grid-cols-4">
            {kpisSecundarios.map((card) => (
              <KpiCard key={card.titulo} {...card} />
            ))}
          </div>
        )}
      </div>

      <ErrorBoundary label="Resumo de receitas">
        <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Resumo de receitas</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
              Faturamento
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              Liq. Marketplace
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Lucro Bruto
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={timeline}
                margin={{ top: 8, right: 14, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="grad-faturamento" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="grad-liquido" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="grad-lucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#059669" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.05} />
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
                      : name === "liquidoMarketplaceCentavos"
                        ? "Liq. Marketplace"
                        : "Lucro Bruto",
                  ]}
                  labelFormatter={(value) => formatDiaCurto(String(value))}
                />
                <Area
                  type="monotone"
                  dataKey="faturamentoCentavos"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  fill="url(#grad-faturamento)"
                  dot={false}
                  name="faturamentoCentavos"
                />
                <Area
                  type="monotone"
                  dataKey="liquidoMarketplaceCentavos"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#grad-liquido)"
                  dot={false}
                  name="liquidoMarketplaceCentavos"
                />
                <Area
                  type="monotone"
                  dataKey="lucroBrutoCentavos"
                  stroke="#059669"
                  strokeWidth={2}
                  fill="url(#grad-lucro)"
                  dot={false}
                  connectNulls
                  name="lucroBrutoCentavos"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
        </Card>
      </ErrorBoundary>

      <ErrorBoundary label="Top 15 produtos">
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
                  <TableHead className="text-center">Margem</TableHead>
                  <TableHead className="text-right">Custo ADS</TableHead>
                  <TableHead className="text-right">Lucro pos Ads</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTop ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Carregando produtos...
                    </TableCell>
                  </TableRow>
                ) : produtosOrdenados.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Sem vendas no periodo.
                    </TableCell>
                  </TableRow>
                ) : (
                  produtosOrdenados.map((produto) => {
                    const imagemAmazon = resolverImagemProduto(
                      produto.amazonImagemUrl,
                      produto.asin,
                      null,
                    );
                    const thumbSrc = produto.imagemUrl && produto.produtoId
                      ? `/api/produtos/${produto.produtoId}/imagem`
                      : imagemAmazon;
                    return (
                      <TableRow key={produto.sku} className="even:bg-muted/30">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ProductThumb
                              src={thumbSrc}
                              alt={produto.nome}
                              size={40}
                              title={produto.nome}
                            />
                            <div className="min-w-0 max-w-[280px]">
                              <p className="truncate font-medium">{produto.nome}</p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {produto.sku}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(produto.precoMedioCentavos)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.custoUnitarioCentavos == null ? (
                            <span className="text-muted-foreground/50">N/A</span>
                          ) : (
                            formatBRL(produto.custoUnitarioCentavos)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.unidades}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatBRL(produto.faturadoCentavos)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatPercent(produto.representatividadePercentual)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.lucroCentavos == null ? (
                            <span className="text-muted-foreground/50">N/A</span>
                          ) : (
                            formatBRL(produto.lucroCentavos)
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <MarginBadge value={produto.margemPercentual} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            produto.custoAdsCentavos > 0 &&
                              "text-amber-700 dark:text-amber-400",
                          )}
                        >
                          {formatBRL(produto.custoAdsCentavos)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.lucroPosAdsCentavos == null ? (
                            <span className="text-muted-foreground/50">N/A</span>
                          ) : (
                            formatBRL(produto.lucroPosAdsCentavos)
                          )}
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
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        </Card>
      </ErrorBoundary>

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

export default function DashboardEcommercePage() {
  return (
    <ErrorBoundary label="Dashboard E-commerce">
      <React.Suspense fallback={null}>
        <DashboardEcommerceContent />
      </React.Suspense>
    </ErrorBoundary>
  );
}
