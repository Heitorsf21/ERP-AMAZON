"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Coins,
  DollarSign,
  Info,
  PercentSquare,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FiltroPeriodo, type FiltroPeriodoValue } from "@/components/ui/filtro-periodo";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  formatarDataInputPeriodo,
  PeriodoPreset,
  resolverPeriodo,
} from "@/lib/periodo";
import { AlertasAds } from "@/components/publicidade/alertas-ads";
import {
  classificarAcos,
  FAIXAS_ACOS,
} from "@/components/publicidade/classificacao-acos";
import { DialogImportarCsv } from "@/components/publicidade/dialog-importar-csv";
import { FunilConversao } from "@/components/publicidade/funil-conversao";
import { GastoManualSection } from "@/components/publicidade/gasto-manual-section";
import { GraficoTimelineAds } from "@/components/publicidade/grafico-timeline-ads";
import { KpiCard } from "@/components/publicidade/kpi-card";
import {
  TabelaCampanhas,
  type CampanhaTabela,
} from "@/components/publicidade/tabela-campanhas";
import { TabelaPorSku } from "@/components/publicidade/tabela-por-sku";

type Comparativo = {
  periodo: { de: string; ate: string };
  totalGasto: number;
  totalVendas: number;
  acosGeral: number | null;
  roasGeral: number | null;
  tacos: number | null;
  delta: {
    gasto: number | null;
    vendas: number | null;
    acos: number | null;
    roas: number | null;
    tacos: number | null;
  };
};

type FonteAds = "SYNC" | "LEGACY" | "MANUAL" | "MIXED" | "VAZIO";

type DadosCampanhas = {
  campanhas: CampanhaTabela[];
  totalGasto: number;
  totalVendas: number;
  acosGeral: number | null;
  roasGeral: number | null;
  tacos: number | null;
  faturamentoAmazon: number | null;
  origem: FonteAds;
  comparativo?: Comparativo;
};

const BADGE_ORIGEM: Record<FonteAds, { label: string; classe: string; descricao: string }> = {
  SYNC: {
    label: "Sync API",
    classe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    descricao: "Dados da Amazon Advertising API (sincronizados a cada 30 min)",
  },
  LEGACY: {
    label: "CSV importado",
    classe: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    descricao: "Dados de relatórios CSV importados manualmente",
  },
  MANUAL: {
    label: "Gasto manual",
    classe: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    descricao: "Apenas registros manuais de gasto (sem sync nem CSV)",
  },
  MIXED: {
    label: "CSV + Manual",
    classe: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
    descricao: "Combinação de CSV importado e gasto manual",
  },
  VAZIO: {
    label: "Sem dados",
    classe: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    descricao: "Nenhum dado de Ads no período",
  },
};

export default function PublicidadePage() {
  const [filtro, setFiltro] = React.useState<FiltroPeriodoValue>({
    preset: PeriodoPreset.MES_ATUAL,
  });
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);

  const periodo = React.useMemo(() => {
    const { de, ate } = resolverPeriodo(filtro.preset, filtro.de, filtro.ate);
    return {
      de: formatarDataInputPeriodo(de),
      ate: formatarDataInputPeriodo(ate),
    };
  }, [filtro]);

  const { data, isLoading } = useQuery<DadosCampanhas>({
    queryKey: ["ads-campanhas", periodo.de, periodo.ate, "comp"],
    queryFn: () =>
      fetchJSON<DadosCampanhas>(
        `/api/ads/campanhas?de=${periodo.de}&ate=${periodo.ate}&comparar=true`,
      ),
  });

  const totals = React.useMemo(() => {
    const cs = data?.campanhas ?? [];
    return {
      impressoes: cs.reduce((a, c) => a + c.impressoes, 0),
      cliques: cs.reduce((a, c) => a + c.cliques, 0),
      pedidos: cs.reduce((a, c) => a + c.pedidos, 0),
    };
  }, [data]);

  const classifAcos = classificarAcos(data?.acosGeral ?? null);
  const origemInfo = data?.origem ? BADGE_ORIGEM[data.origem] : null;
  const totalCampanhas = data?.campanhas.length ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Publicidade"
          description="Amazon Ads — desempenho de campanhas e investimento por produto."
        />
        {origemInfo && (
          <span
            className={cn(
              "shrink-0 self-start rounded-md px-2.5 py-1 text-xs font-semibold",
              origemInfo.classe,
            )}
            title={origemInfo.descricao}
          >
            {origemInfo.label}
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <FiltroPeriodo value={filtro} onChange={setFiltro} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
          >
            <Upload className="mr-2 h-4 w-4" />
            Importar CSV
          </Button>
          <Button asChild size="sm">
            <Link href="/publicidade/otimizador">
              <Zap className="mr-2 h-4 w-4" />
              Otimizador
            </Link>
          </Button>
        </div>
      </div>

      {/* KPIs — padrão do Dashboard (barra lateral âmbar = categoria ads) */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Investido"
            value={formatBRL(data?.totalGasto ?? 0)}
            icon={Coins}
            delta={data?.comparativo?.delta.gasto ?? null}
            polaridade="padrao"
          />
          <KpiCard
            label="Vendas atribuídas"
            value={formatBRL(data?.totalVendas ?? 0)}
            icon={DollarSign}
            delta={data?.comparativo?.delta.vendas ?? null}
            polaridade="invertida"
          />
          <KpiCard
            label="ACoS"
            value={
              data?.acosGeral != null ? `${data.acosGeral.toFixed(1)}%` : "—"
            }
            sub="gasto / vendas atribuídas"
            icon={PercentSquare}
            delta={data?.comparativo?.delta.acos ?? null}
            polaridade="padrao"
            destaqueLabel={data?.acosGeral != null ? classifAcos.label : undefined}
            destaqueClasse={classifAcos.classe}
          />
          <KpiCard
            label="ROAS"
            value={
              data?.roasGeral != null ? `${data.roasGeral.toFixed(2)}x` : "—"
            }
            sub="vendas / gasto"
            icon={TrendingUp}
            delta={data?.comparativo?.delta.roas ?? null}
            polaridade="invertida"
          />
          <KpiCard
            label="TACoS"
            value={data?.tacos != null ? `${data.tacos.toFixed(1)}%` : "—"}
            sub="gasto / vendas Amazon totais"
            icon={BarChart3}
            delta={data?.comparativo?.delta.tacos ?? null}
            polaridade="padrao"
          />
        </div>
      )}

      {/* Sinais de atenção — strip acionável logo abaixo dos KPIs */}
      {!isLoading && data?.campanhas && (
        <AlertasAds campanhas={data.campanhas} />
      )}

      {/* Gráfico (2/3) + Funil (1/3) */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <GraficoTimelineAds de={periodo.de} ate={periodo.ate} />
        </div>
        {isLoading ? (
          <Skeleton className="h-72 rounded-lg" />
        ) : (
          <FunilConversao
            impressoes={totals.impressoes}
            cliques={totals.cliques}
            pedidos={totals.pedidos}
            vendasCentavos={data?.totalVendas ?? 0}
            gastoCentavos={data?.totalGasto ?? 0}
          />
        )}
      </div>

      {/* Tabs com as três visões */}
      <Tabs defaultValue="campanhas" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="campanhas">
              Campanhas
              {totalCampanhas > 0 && (
                <span className="ml-1.5 text-muted-foreground">
                  {totalCampanhas}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="por-sku">Por SKU</TabsTrigger>
            <TabsTrigger value="manual">Gasto manual</TabsTrigger>
          </TabsList>
          <EscalaAcosPopover />
        </div>
        <TabsContent value="campanhas" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <TabelaCampanhas
                  campanhas={data?.campanhas ?? []}
                  onImportar={() => setImportDialogOpen(true)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="por-sku" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <TabelaPorSku de={periodo.de} ate={periodo.ate} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="manual" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <GastoManualSection de={periodo.de} ate={periodo.ate} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DialogImportarCsv
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        periodoInicial={periodo}
      />
    </div>
  );
}

/** A escala de faixas saiu do card no rodapé e virou este popover ⓘ. */
function EscalaAcosPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground"
          aria-label="Escala de ACoS"
        >
          <Info className="h-3.5 w-3.5" />
          Escala de ACoS
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Escala de ACoS
        </p>
        <div className="space-y-1.5 text-xs">
          {FAIXAS_ACOS.map((f) => {
            const ref = classificarAcos(f.ref);
            return (
              <div key={f.label} className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-medium",
                    ref.classe,
                  )}
                >
                  {f.label}
                </span>
                <span className="text-muted-foreground">{f.range}</span>
                <span className="ml-auto text-muted-foreground/80">{ref.acao}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
