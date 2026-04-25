"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Download,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Upload,
  Zap,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Campanha = {
  id: string;
  nomeCampanha: string;
  sku: string | null;
  asin: string | null;
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasAtribuidasCentavos: number;
  pedidos: number;
  acosPercentual: number | null;
  roas: number | null;
  periodoInicio: string;
  periodoFim: string;
};

type DadosCampanhas = {
  campanhas: Campanha[];
  totalGasto: number;
  totalVendas: number;
  acosGeral: number | null;
  roasGeral: number | null;
};

type ClassAcoS = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  classe: string;
  acao: string;
};

function classificarAcos(acos: number | null): ClassAcoS {
  if (acos == null) return { label: "N/A", variant: "secondary", classe: "text-muted-foreground", acao: "Sem dados" };
  if (acos < 10) return { label: "Baixo", variant: "default", classe: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", acao: "Vale aumentar o lance" };
  if (acos < 15) return { label: "Ótimo", variant: "default", classe: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", acao: "Manter estratégia" };
  if (acos < 20) return { label: "Bom", variant: "default", classe: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200", acao: "Monitorar" };
  if (acos < 25) return { label: "Ok", variant: "outline", classe: "bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", acao: "Avaliar ajuste" };
  if (acos < 30) return { label: "Atenção", variant: "outline", classe: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300", acao: "Reduzir lance" };
  if (acos < 40) return { label: "Alerta", variant: "destructive", classe: "", acao: "Revisar campanha" };
  return { label: "Crítico", variant: "destructive", classe: "bg-red-800 text-white", acao: "Pausar campanha" };
}

function periodoDefault() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { de: fmt(ini), ate: fmt(hoje) };
}

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  destaque,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  destaque?: ClassAcoS;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        {destaque && (
          <div className="mt-3 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
                destaque.classe,
              )}
            >
              {destaque.label}
            </span>
            <span className="text-xs text-muted-foreground">{destaque.acao}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PublicidadePage() {
  const queryClient = useQueryClient();
  const [periodo, setPeriodo] = React.useState(periodoDefault);
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importPeriodo, setImportPeriodo] = React.useState(periodoDefault);

  const { data, isLoading } = useQuery<DadosCampanhas>({
    queryKey: ["ads-campanhas", periodo],
    queryFn: () =>
      fetchJSON(`/api/ads/campanhas?de=${periodo.de}&ate=${periodo.ate}`),
  });

  const importarMut = useMutation({
    mutationFn: async () => {
      if (!importFile) throw new Error("Selecione um arquivo");
      const form = new FormData();
      form.append("arquivo", importFile);
      form.append("periodoInicio", importPeriodo.de);
      form.append("periodoFim", importPeriodo.ate);
      const res = await fetch("/api/ads/importar-campanha", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao importar");
      }
      return res.json() as Promise<{ importadas: number }>;
    },
    onSuccess: (res) => {
      toast.success(`${res.importadas} campanhas importadas com sucesso`);
      setImportDialogOpen(false);
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ["ads-campanhas"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const alertas =
    data?.campanhas.filter((c) => (c.acosPercentual ?? 0) > 30) ?? [];

  const classeAcosGeral = classificarAcos(data?.acosGeral ?? null);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Publicidade"
        description="Análise de campanhas e ACoS"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setImportDialogOpen(true)}
        >
          <Upload className="mr-2 h-4 w-4" />
          Importar relatório
        </Button>
      </PageHeader>

      {/* Filtro de período */}
      <div className="flex items-end gap-3">
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
      </div>

      {/* Alerta de campanhas críticas */}
      {alertas.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <div className="text-sm text-orange-800 dark:text-orange-300">
            <span className="font-medium">
              {alertas.length} campanha{alertas.length > 1 ? "s" : ""} com ACoS acima de 30%
            </span>{" "}
            — revise lances e palavras-chave para reduzir o custo por venda.
          </div>
        </div>
      )}

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KPICard
            label="Total investido"
            value={formatBRL(data?.totalGasto ?? 0)}
            icon={Download}
          />
          <KPICard
            label="Vendas atribuídas"
            value={formatBRL(data?.totalVendas ?? 0)}
            icon={BarChart3}
          />
          <KPICard
            label="ACoS médio"
            value={
              data?.acosGeral != null
                ? `${data.acosGeral.toFixed(1)}%`
                : "N/A"
            }
            sub="(gasto / vendas atribuídas)"
            icon={Zap}
            destaque={classeAcosGeral}
          />
          <KPICard
            label="ROAS médio"
            value={
              data?.roasGeral != null
                ? `${data.roasGeral.toFixed(2)}x`
                : "N/A"
            }
            sub="(vendas / gasto)"
            icon={data?.roasGeral != null && data.roasGeral >= 4 ? TrendingUp : TrendingDown}
          />
        </div>
      )}

      {/* Tabela de campanhas */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Campanhas ({data?.campanhas.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !data?.campanhas.length ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <BarChart3 className="h-8 w-8 opacity-40" />
              <p className="text-sm">Nenhuma campanha importada</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Importar relatório de Ads
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead className="text-right">Investido</TableHead>
                    <TableHead className="text-right">Vendas atrib.</TableHead>
                    <TableHead className="text-right">ACoS</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">Cliques</TableHead>
                    <TableHead className="text-right">Pedidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.campanhas.map((c) => {
                    const classif = classificarAcos(c.acosPercentual);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="max-w-[200px] truncate font-medium text-sm">
                            {c.nomeCampanha}
                          </div>
                          {c.sku && (
                            <div className="text-xs text-muted-foreground">{c.sku}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatBRL(c.gastoCentavos)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {c.vendasAtribuidasCentavos > 0
                            ? formatBRL(c.vendasAtribuidasCentavos)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="text-sm">
                              {c.acosPercentual != null
                                ? `${c.acosPercentual.toFixed(1)}%`
                                : "—"}
                            </span>
                            <span
                              className={cn(
                                "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
                                classif.classe,
                              )}
                            >
                              {classif.label}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {c.roas != null ? `${c.roas.toFixed(2)}x` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {c.cliques.toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {c.pedidos}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legenda ACoS */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Escala de ACoS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { range: "< 10%", label: "Baixo", classe: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
              { range: "10–15%", label: "Ótimo", classe: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
              { range: "15–20%", label: "Bom", classe: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" },
              { range: "20–25%", label: "Ok", classe: "bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border" },
              { range: "25–30%", label: "Atenção", classe: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
              { range: "30–40%", label: "Alerta", classe: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
              { range: "> 40%", label: "Crítico", classe: "bg-red-800 text-white" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1">
                <span className={cn("rounded px-1.5 py-0.5 font-medium", item.classe)}>
                  {item.label}
                </span>
                <span className="text-muted-foreground">{item.range}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dialog de importação */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar relatório de Ads</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Baixe o relatório de campanhas no Amazon Seller Central → Publicidade → Relatórios de Campanhas e faça upload aqui. Aceita CSV ou TSV com colunas: Campaign Name, Spend, Sales, ACoS, ROAS.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Período início</Label>
                <Input
                  type="date"
                  value={importPeriodo.de}
                  onChange={(e) =>
                    setImportPeriodo((p) => ({ ...p, de: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Período fim</Label>
                <Input
                  type="date"
                  value={importPeriodo.ate}
                  onChange={(e) =>
                    setImportPeriodo((p) => ({ ...p, ate: e.target.value }))
                  }
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Arquivo CSV/TSV</Label>
              <Input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => importarMut.mutate()}
                disabled={!importFile || importarMut.isPending}
              >
                {importarMut.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Importar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
