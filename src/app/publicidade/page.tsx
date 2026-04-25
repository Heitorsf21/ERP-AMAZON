"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Coins,
  DollarSign,
  PercentSquare,
  TrendingUp,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AlertasAds } from "@/components/publicidade/alertas-ads";
import {
  classificarAcos,
  FAIXAS_ACOS,
} from "@/components/publicidade/classificacao-acos";
import { DialogImportarCsv } from "@/components/publicidade/dialog-importar-csv";
import { FunilConversao } from "@/components/publicidade/funil-conversao";
import { GastoManualSection } from "@/components/publicidade/gasto-manual-section";
import { GraficoTimelineAds } from "@/components/publicidade/grafico-timeline-ads";
import {
  KpiCard,
  type DeltaPolaridade,
} from "@/components/publicidade/kpi-card";
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

type DadosCampanhas = {
  campanhas: CampanhaTabela[];
  totalGasto: number;
  totalVendas: number;
  acosGeral: number | null;
  roasGeral: number | null;
  tacos: number | null;
  faturamentoAmazon: number | null;
  comparativo?: Comparativo;
};

function periodoDefault() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { de: fmt(ini), ate: fmt(hoje) };
}

export default function PublicidadePage() {
  const [periodo, setPeriodo] = React.useState(periodoDefault);
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);

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

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Publicidade Amazon Ads"
        description="Análise de campanhas, ACoS, ROAS e TACoS — dados via importação manual de relatórios CSV."
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs">De</Label>
          <Input
            type="date"
            value={periodo.de}
            onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
            className="w-40"
          />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input
            type="date"
            value={periodo.ate}
            onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
            className="w-40"
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
          >
            <Upload className="mr-2 h-4 w-4" />
            Importar CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
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

      {/* Funil */}
      {!isLoading && (
        <FunilConversao
          impressoes={totals.impressoes}
          cliques={totals.cliques}
          pedidos={totals.pedidos}
          vendasCentavos={data?.totalVendas ?? 0}
          gastoCentavos={data?.totalGasto ?? 0}
        />
      )}

      {/* Timeline */}
      <GraficoTimelineAds de={periodo.de} ate={periodo.ate} />

      {/* Tabs com as três visões */}
      <Tabs defaultValue="campanhas" className="w-full">
        <TabsList>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="por-sku">Por SKU</TabsTrigger>
          <TabsTrigger value="manual">Gasto manual</TabsTrigger>
        </TabsList>
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

      {/* Alertas */}
      {!isLoading && data?.campanhas && (
        <AlertasAds campanhas={data.campanhas} />
      )}

      {/* Legenda ACoS */}
      <Card>
        <CardContent className="pt-6">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Escala de ACoS
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {FAIXAS_ACOS.map((f) => {
              const ref = classificarAcos(
                f.label === "Excelente"
                  ? 10
                  : f.label === "Bom"
                    ? 20
                    : f.label === "Atenção"
                      ? 30
                      : f.label === "Alto"
                        ? 45
                        : 60,
              );
              return (
                <div key={f.label} className="flex items-center gap-1">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-medium",
                      ref.classe,
                    )}
                  >
                    {f.label}
                  </span>
                  <span className="text-muted-foreground">{f.range}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <DialogImportarCsv
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        periodoInicial={periodo}
      />
    </div>
  );
}
