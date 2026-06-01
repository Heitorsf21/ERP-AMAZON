"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Filter,
  History,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type OptimizerMetrics = {
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  pedidos: number;
  unidades: number;
  acos: number | null;
  roas: number | null;
  ctr: number | null;
  cpcCentavos: number | null;
  conversao: number | null;
};

type RecommendationStatus =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED"
  | "FAILED"
  | "STALE";

type Recommendation = {
  id: string;
  status: RecommendationStatus;
  entityType: "KEYWORD" | "TARGET" | "SEARCH_TERM";
  entityId: string;
  label: string;
  campaignName: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  adGroupName: string | null;
  keywordId: string | null;
  targetId: string | null;
  searchTerm: string | null;
  sku: string | null;
  asin: string | null;
  actionType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  ruleId: string;
  motivo: string;
  risco: string;
  confianca: number;
  currentBidCentavos: number | null;
  proposedBidCentavos: number | null;
  beforeState: string | null;
  proposedState: string | null;
  metrics7d: OptimizerMetrics;
  metrics30d: OptimizerMetrics;
  metricsLifetime: OptimizerMetrics;
  criadoEm: string;
  aprovadoEm: string | null;
  executadoEm: string | null;
  staleReason: string | null;
  errorMessage: string | null;
};

type Snapshot = {
  profileId: string;
  lastRun: {
    id: string;
    status: string;
    iniciadoEm: string;
    finalizadoEm: string | null;
    totalEntidades: number;
    totalRecomendacoes: number;
    erro: string | null;
  } | null;
  totals: {
    proposed: number;
    approved: number;
    failed: number;
    stale: number;
  };
  coverage: OptimizerCoverage | null;
  recommendations: Recommendation[];
};

type MutationResult = {
  status?: "PENDING_REPORTS" | "COOLDOWN";
  retryAt?: string;
  total?: number;
  applied?: number;
  failed?: number;
  stale?: number;
  totalRecomendacoes?: number;
};

type ReportWindow = {
  startDate: string;
  endDate: string;
};

type BackfillReportResult = {
  status: "PENDING_NEW" | "PENDING_PROCESSING" | "FAILED" | "DONE" | "COMPLETE";
  reportId?: string;
  processingStatus?: string;
  window?: ReportWindow;
  rows?: number;
  saved?: number;
  cursor?: string | null;
  complete?: boolean;
};

type OptimizerCoverage = {
  earliestAvailable: string;
  latestClosed: string;
  expectedDays: number;
  historyStartDate: string | null;
  historyEndDate: string | null;
  targeting: MetricCoverage;
  searchTerms: MetricCoverage;
  backfill: {
    targeting: BackfillState;
    searchTerms: BackfillState;
    pending: boolean;
    complete: boolean;
  };
};

type MetricCoverage = {
  minDate: string | null;
  maxDate: string | null;
  rows: number;
  daysWithData: number;
  expectedDays: number;
};

type BackfillState = {
  status: "PENDING" | "READY" | "COMPLETE";
  pendingId: string | null;
  window: ReportWindow | null;
  cursor: string | null;
  progressPct: number;
  lastCompletedAt: string | null;
};

type BackfillResult = {
  reports:
    | {
        status: "COOLDOWN";
        operation: string;
        retryAt: string;
      }
    | {
        targeting: BackfillReportResult;
        searchTerms: BackfillReportResult;
      };
  coverage: OptimizerCoverage;
};

const STATUS_LABEL: Record<RecommendationStatus, string> = {
  PROPOSED: "Pendente",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  APPLIED: "Aplicada",
  FAILED: "Falhou",
  STALE: "Obsoleta",
};

const ACTION_LABEL: Record<string, string> = {
  INCREASE_BID: "Aumentar lance",
  DECREASE_BID: "Reduzir lance",
  PAUSE_KEYWORD: "Pausar keyword",
  PAUSE_TARGET: "Pausar target",
  ADD_NEGATIVE_KEYWORD: "Negativar keyword",
  ADD_NEGATIVE_TARGET: "Negativar target",
  CREATE_EXACT_KEYWORD: "Criar exact",
};

const SEVERITY_LABEL: Record<Recommendation["severity"], string> = {
  LOW: "Baixa",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Critica",
};

export default function AdsOptimizerPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const [actionFilter, setActionFilter] = React.useState("ALL");
  const [severityFilter, setSeverityFilter] = React.useState("ALL");
  const [ruleFilter, setRuleFilter] = React.useState("ALL");
  const [search, setSearch] = React.useState("");

  const query = useQuery<Snapshot>({
    queryKey: ["ads-optimizer-snapshot"],
    queryFn: () => fetchJSON<Snapshot>("/api/ads/optimizer/snapshot"),
  });

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ads-optimizer-snapshot"] });
  }, [queryClient]);

  const runMutation = useMutation({
    mutationFn: () =>
      fetchJSON<MutationResult>("/api/ads/optimizer/run", { method: "POST" }),
    onSuccess: (data) => {
      if (data.status === "PENDING_REPORTS") {
        toast.warning(
          "Relatorios solicitados na Amazon. Aguarde alguns minutos e rode novamente para baixar as metricas.",
        );
      } else if (data.status === "COOLDOWN") {
        toast.warning(
          `Amazon em cooldown. Tente novamente apos ${data.retryAt ? formatDateTime(data.retryAt) : "alguns minutos"}.`,
        );
      } else {
        toast.success(`${data.totalRecomendacoes ?? 0} recomendacao(oes) gerada(s)`);
      }
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      fetchJSON<BackfillResult>("/api/ads/optimizer/backfill", { method: "POST" }),
    onSuccess: (data) => {
      if ("status" in data.reports && data.reports.status === "COOLDOWN") {
        toast.warning(
          `Amazon em cooldown. Tente novamente apos ${formatDateTime(data.reports.retryAt)}.`,
        );
        invalidate();
        return;
      }
      const reports = "targeting" in data.reports
        ? [data.reports.targeting, data.reports.searchTerms]
        : [];
      const completed = reports.filter((report) => report.status === "DONE").length;
      const pending = reports.filter((report) =>
        report.status === "PENDING_NEW" || report.status === "PENDING_PROCESSING",
      ).length;
      if (data.coverage.backfill.complete) {
        toast.success("Historico maximo da Amazon Ads ja esta coberto.");
      } else if (completed > 0) {
        toast.success(`${completed} janela(s) historica(s) importada(s).`);
      } else if (pending > 0) {
        toast.info("Reports historicos solicitados. Aguarde alguns minutos e clique novamente.");
      } else {
        toast.info("Backfill historico atualizado.");
      }
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const executeMutation = useMutation({
    mutationFn: () =>
      fetchJSON<MutationResult>("/api/ads/optimizer/execute-approved", {
        method: "POST",
      }),
    onSuccess: (data) => {
      toast.success(
        `${data.applied ?? 0} aplicada(s), ${data.stale ?? 0} obsoleta(s), ${data.failed ?? 0} falha(s)`,
      );
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/ads/optimizer/recommendations/${id}/approve`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Recomendacao aprovada");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/ads/optimizer/recommendations/${id}/reject`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Recomendacao rejeitada");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recommendations = query.data?.recommendations ?? [];
  const coverage = query.data?.coverage ?? null;
  const historyLabel = coverage?.historyStartDate
    ? `Historico desde ${formatDate(coverage.historyStartDate)}`
    : "Historico disponivel";
  const filtered = recommendations.filter((rec) => {
    if (statusFilter !== "ALL" && rec.status !== statusFilter) return false;
    if (actionFilter !== "ALL" && rec.actionType !== actionFilter) return false;
    if (severityFilter !== "ALL" && rec.severity !== severityFilter) return false;
    if (ruleFilter !== "ALL" && rec.ruleId !== ruleFilter) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
      rec.campaignName,
      rec.portfolioName,
      rec.adGroupName,
      rec.label,
      rec.searchTerm,
      rec.sku,
      rec.asin,
      rec.entityId,
      rec.ruleId,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  const actionOptions = unique(recommendations.map((rec) => rec.actionType));
  const ruleOptions = unique(recommendations.map((rec) => rec.ruleId));
  const isBusy =
    runMutation.isPending ||
    backfillMutation.isPending ||
    executeMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="Otimizador de Ads"
        description="Regras deterministicas para Amazon Ads com aprovacao humana antes de qualquer alteracao."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => backfillMutation.mutate()}
          disabled={isBusy}
        >
          <History className={cn("mr-2 h-4 w-4", backfillMutation.isPending && "animate-spin")} />
          Buscar historico
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={isBusy}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", runMutation.isPending && "animate-spin")} />
          Sincronizar e analisar
        </Button>
        <Button
          size="sm"
          onClick={() => executeMutation.mutate()}
          disabled={isBusy || (query.data?.totals.approved ?? 0) === 0}
        >
          <Play className="mr-2 h-4 w-4" />
          Executar aprovadas
        </Button>
      </PageHeader>

      <CoveragePanel
        coverage={coverage}
        loading={query.isLoading}
        busy={isBusy}
        onBackfill={() => backfillMutation.mutate()}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Pendentes" value={query.data?.totals.proposed ?? 0} tone="amber" />
        <SummaryCard label="Aprovadas" value={query.data?.totals.approved ?? 0} tone="blue" />
        <SummaryCard label="Falhas" value={query.data?.totals.failed ?? 0} tone="red" />
        <SummaryCard label="Obsoletas" value={query.data?.totals.stale ?? 0} tone="slate" />
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Busca
            </div>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Campanha, SKU, termo ou regra"
            />
          </div>
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
            <option value="ALL">Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Acao" value={actionFilter} onChange={setActionFilter}>
            <option value="ALL">Todas</option>
            {actionOptions.map((value) => (
              <option key={value} value={value}>
                {ACTION_LABEL[value] ?? value}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Severidade"
            value={severityFilter}
            onChange={setSeverityFilter}
          >
            <option value="ALL">Todas</option>
            {Object.entries(SEVERITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FilterSelect>
          <div className="md:col-span-5">
            <FilterSelect label="Regra" value={ruleFilter} onChange={setRuleFilter}>
              <option value="ALL">Todas as regras</option>
              {ruleOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </FilterSelect>
          </div>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="grid gap-3">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasData={recommendations.length > 0} />
      ) : (
        <div className="grid gap-3">
          {filtered.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              historyLabel={historyLabel}
              busy={isBusy}
              onApprove={() => approveMutation.mutate(rec.id)}
              onReject={() => rejectMutation.mutate(rec.id)}
            />
          ))}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {query.data?.lastRun ? (
          <span>
            Ultima rodada: {formatDateTime(query.data.lastRun.iniciadoEm)} ·{" "}
            {query.data.lastRun.totalEntidades} entidades analisadas ·{" "}
            {query.data.lastRun.totalRecomendacoes} recomendacoes
          </span>
        ) : (
          <span>Nenhuma rodada executada ainda.</span>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "blue" | "red" | "slate";
}) {
  const toneClass = {
    amber: "border-l-amber-500",
    blue: "border-l-blue-500",
    red: "border-l-red-500",
    slate: "border-l-slate-400",
  }[tone];
  return (
    <Card className={cn("border-l-4", toneClass)}>
      <CardContent className="pt-5">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function CoveragePanel({
  coverage,
  loading,
  busy,
  onBackfill,
}: {
  coverage: OptimizerCoverage | null;
  loading: boolean;
  busy: boolean;
  onBackfill: () => void;
}) {
  if (loading) return <Skeleton className="h-44 rounded-lg" />;
  if (!coverage) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Historico Ads nao carregado</p>
            <p className="text-sm text-muted-foreground">
              Configure o profile de Amazon Ads e rode uma sincronizacao.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onBackfill} disabled={busy}>
            <History className="mr-2 h-4 w-4" />
            Buscar historico
          </Button>
        </CardContent>
      </Card>
    );
  }

  const periodLabel = `${formatDate(coverage.earliestAvailable)} a ${formatDate(coverage.latestClosed)}`;
  const historyLabel = coverage.historyStartDate
    ? `${formatDate(coverage.historyStartDate)} a ${coverage.historyEndDate ? formatDate(coverage.historyEndDate) : "-"}`
    : "Sem metricas granulares salvas";

  return (
    <Card className="overflow-hidden border-l-4 border-l-amber-500">
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-amber-50 text-amber-800">
                <CalendarClock className="mr-1 h-3.5 w-3.5" />
                Limite Amazon: {periodLabel}
              </Badge>
              <Badge variant="outline">
                {coverage.backfill.complete ? "Backfill completo" : "Backfill em andamento"}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-semibold">Historico granular disponivel</p>
              <p className="text-sm text-muted-foreground">
                {historyLabel}. Este periodo alimenta keyword, target, search term e as regras
                de otimizacao.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={onBackfill} disabled={busy}>
            <History className="mr-2 h-4 w-4" />
            Continuar backfill
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <CoverageTile
            title="Targeting e keywords"
            coverage={coverage.targeting}
            state={coverage.backfill.targeting}
          />
          <CoverageTile
            title="Search terms"
            coverage={coverage.searchTerms}
            state={coverage.backfill.searchTerms}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CoverageTile({
  title,
  coverage,
  state,
}: {
  title: string;
  coverage: MetricCoverage;
  state: BackfillState;
}) {
  const range = coverage.minDate
    ? `${formatDate(coverage.minDate)} a ${coverage.maxDate ? formatDate(coverage.maxDate) : "-"}`
    : "Sem dados";
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{range}</p>
        </div>
        <BackfillBadge state={state.status} />
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-amber-500 transition-all"
          style={{ width: `${Math.max(4, state.progressPct)}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Fact label="Linhas" value={String(coverage.rows)} />
        <Fact label="Dias c/ dados" value={String(coverage.daysWithData)} />
        <Fact label="Progresso" value={`${state.progressPct}%`} />
      </div>
      {state.window && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Janela pendente: {formatDate(state.window.startDate)} a{" "}
          {formatDate(state.window.endDate)}
        </p>
      )}
    </div>
  );
}

function BackfillBadge({ state }: { state: BackfillState["status"] }) {
  if (state === "COMPLETE") {
    return <Badge className="border-transparent bg-emerald-600 text-white">Completo</Badge>;
  }
  if (state === "PENDING") {
    return <Badge className="border-transparent bg-amber-500 text-white">Pendente</Badge>;
  }
  return <Badge variant="outline">Pronto</Badge>;
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </Select>
    </label>
  );
}

function RecommendationCard({
  rec,
  historyLabel,
  busy,
  onApprove,
  onReject,
}: {
  rec: Recommendation;
  historyLabel: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const canReview = rec.status === "PROPOSED" || rec.status === "APPROVED";
  return (
    <Card className={cn("overflow-hidden border-l-4", severityBorderClass(rec.severity))}>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={severityClass(rec.severity)}>
                {SEVERITY_LABEL[rec.severity]}
              </Badge>
              <Badge variant="outline">{STATUS_LABEL[rec.status] ?? rec.status}</Badge>
              <span className="text-sm font-semibold">
                {ACTION_LABEL[rec.actionType] ?? rec.actionType}
              </span>
              <span className="text-xs text-muted-foreground">{rec.ruleId}</span>
            </div>
            <div>
              <h2 className="break-words text-base font-semibold">
                {entityTitle(rec)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {rec.campaignName ?? "Campanha sem nome"}
                {rec.portfolioName ? ` · Portfolio ${rec.portfolioName}` : ""}
                {rec.adGroupName ? ` · ${rec.adGroupName}` : ""}
                {rec.sku ? ` · SKU ${rec.sku}` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onApprove}
              disabled={busy || rec.status !== "PROPOSED"}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onReject}
              disabled={busy || !canReview}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Rejeitar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-2 text-sm">
            <p>{rec.motivo}</p>
            <p className="text-muted-foreground">
              <ShieldCheck className="mr-1 inline h-4 w-4 align-text-bottom" />
              Risco: {rec.risco}
            </p>
            {(rec.staleReason || rec.errorMessage) && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {rec.staleReason ?? rec.errorMessage}
              </p>
            )}
          </div>
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <Fact label="Antes" value={beforeValue(rec)} />
            <Fact label="Depois" value={afterValue(rec)} />
            <Fact label="Confianca" value={`${rec.confianca}%`} />
            <Fact label="Criada em" value={formatDateTime(rec.criadoEm)} />
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          <MetricsBlock label="7 dias" metrics={rec.metrics7d} />
          <MetricsBlock label="30 dias" metrics={rec.metrics30d} />
          <MetricsBlock label={historyLabel} metrics={rec.metricsLifetime} />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsBlock({ label, metrics }: { label: string; metrics: OptimizerMetrics }) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Fact label="Gasto" value={formatBRL(metrics.gastoCentavos)} />
        <Fact label="Vendas" value={formatBRL(metrics.vendasCentavos)} />
        <Fact label="Cliques" value={String(metrics.cliques)} />
        <Fact label="Pedidos" value={String(metrics.pedidos)} />
        <Fact label="ACOS" value={formatPct(metrics.acos)} />
        <Fact label="CPC" value={formatMoneyOrDash(metrics.cpcCentavos)} />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ hasData }: { hasData: boolean }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="text-sm font-medium">
          {hasData ? "Nenhuma recomendacao nos filtros atuais." : "Nenhuma recomendacao gerada."}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Execute uma rodada para sincronizar entidades editaveis e gerar sugestoes.
        </p>
      </CardContent>
    </Card>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function entityTitle(rec: Recommendation) {
  return rec.label || rec.searchTerm || rec.entityId;
}

function beforeValue(rec: Recommendation) {
  if (rec.currentBidCentavos != null) return `Lance ${formatBRL(rec.currentBidCentavos)}`;
  return rec.beforeState ?? "-";
}

function afterValue(rec: Recommendation) {
  if (rec.proposedBidCentavos != null) return `Lance ${formatBRL(rec.proposedBidCentavos)}`;
  return rec.proposedState ?? "-";
}

function formatPct(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function formatMoneyOrDash(value: number | null) {
  return value == null ? "-" : formatBRL(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function severityBorderClass(severity: Recommendation["severity"]) {
  if (severity === "CRITICAL") return "border-l-red-600";
  if (severity === "HIGH") return "border-l-orange-600";
  if (severity === "MEDIUM") return "border-l-amber-500";
  return "border-l-emerald-600";
}

function severityClass(severity: Recommendation["severity"]) {
  if (severity === "CRITICAL") return "border-transparent bg-red-600 text-white";
  if (severity === "HIGH") return "border-transparent bg-orange-600 text-white";
  if (severity === "MEDIUM") return "border-transparent bg-amber-500 text-white";
  return "border-transparent bg-emerald-600 text-white";
}
