"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eye,
  Filter,
  History,
  Layers3,
  Package,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  displayEntityType: string;
  entityId: string;
  label: string;
  displayLabel: string;
  campaignId: string;
  campaignName: string | null;
  campaignTargetingType: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  keywordId: string | null;
  targetId: string | null;
  searchTerm: string | null;
  matchType: string | null;
  sku: string | null;
  asin: string | null;
  skuAttributionStatus: "RESOLVED" | "UNRESOLVED";
  skuAttributionSource: string;
  isExecutable: boolean;
  blockedReason: string | null;
  actionType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  ruleId: string;
  motivo: string;
  risco: string;
  confianca: number;
  currentBidCentavos: number | null;
  proposedBidCentavos: number | null;
  approvedBidCentavos: number | null;
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
  dryRun?: number;
  failed?: number;
  stale?: number;
  totalRecomendacoes?: number;
};

type ApprovalInput = {
  bidCentavos?: number | null;
};

type SkuGroup = {
  key: string;
  sku: string;
  asin: string | null;
  recommendations: Recommendation[];
  totals30d: OptimizerMetrics;
  criticalCount: number;
  approvedCount: number;
  proposedCount: number;
  actionGroupCount: number;
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
  PAUSE_KEYWORD: "Pausar palavra-chave",
  PAUSE_TARGET: "Pausar segmentacao",
  ADD_NEGATIVE_KEYWORD: "Negativar termo",
  ADD_NEGATIVE_TARGET: "Negativar ASIN",
  CREATE_EXACT_KEYWORD: "Criar palavra-chave exata",
};

const MATCH_TYPE_LABEL: Record<string, string> = {
  BROAD: "Ampla",
  PHRASE: "Frase",
  EXACT: "Exata",
  MANUAL: "Manual",
  AUTO: "Automatica",
};

const SEVERITY_LABEL: Record<Recommendation["severity"], string> = {
  LOW: "Baixa",
  MEDIUM: "Media",
  HIGH: "Alta",
  CRITICAL: "Critica",
};

export default function AdsOptimizerPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState("PROPOSED");
  const [actionFilter, setActionFilter] = React.useState("ALL");
  const [severityFilter, setSeverityFilter] = React.useState("ALL");
  const [campaignTypeFilter, setCampaignTypeFilter] = React.useState("ALL");
  const [entityTypeFilter, setEntityTypeFilter] = React.useState("ALL");
  const [matchTypeFilter, setMatchTypeFilter] = React.useState("ALL");
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
        toast.success(`${data.totalRecomendacoes ?? 0} acoes encontradas`);
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
        toast.success(`${completed} janela historica importada`);
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
      if ((data.dryRun ?? 0) > 0) {
        toast.success(`${data.dryRun} simulacao, nenhuma alteracao enviada para Amazon`);
      } else {
        toast.success(
          `${data.applied ?? 0} aplicada, ${data.stale ?? 0} obsoleta, ${data.failed ?? 0} falha`,
        );
      }
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApprovalInput }) =>
      fetchJSON(`/api/ads/optimizer/recommendations/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      toast.success("Acao aprovada");
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
      toast.success("Acao rejeitada");
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
    if (campaignTypeFilter !== "ALL" && rec.campaignTargetingType !== campaignTypeFilter) {
      return false;
    }
    if (entityTypeFilter !== "ALL" && rec.entityType !== entityTypeFilter) return false;
    if (matchTypeFilter !== "ALL" && rec.matchType !== matchTypeFilter) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
      rec.campaignName,
      rec.portfolioName,
      rec.adGroupName,
      rec.displayLabel,
      rec.label,
      rec.searchTerm,
      rec.matchType ? matchTypeLabel(rec.matchType) : null,
      rec.sku,
      rec.asin,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  const actionOptions = unique(recommendations.map((rec) => rec.actionType));
  const campaignTypeOptions = unique(
    recommendations.map((rec) => rec.campaignTargetingType).filter(Boolean) as string[],
  );
  const matchTypeOptions = unique(
    recommendations.map((rec) => rec.matchType).filter(Boolean) as string[],
  );
  const grouped = React.useMemo(() => groupRecommendations(filtered), [filtered]);
  const pendingRecommendations = recommendations.filter((rec) => rec.status === "PROPOSED");
  const approvedRecommendations = recommendations.filter((rec) => rec.status === "APPROVED");
  const blockedPending = pendingRecommendations.filter((rec) => !rec.isExecutable);
  const pendingGroupCount = countActionGroups(pendingRecommendations);
  const approvedGroupCount = countActionGroups(approvedRecommendations);
  const blockedPendingCount = countActionGroups(blockedPending);
  const isBusy =
    runMutation.isPending ||
    backfillMutation.isPending ||
    executeMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending;
  const executableApproved = recommendations.filter(
    (rec) => rec.status === "APPROVED" && rec.isExecutable,
  ).length;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="Otimizador de Ads"
        description="Acoes por SKU para ajustar lances, pausar desperdicio e transformar bons termos em campanhas mais controladas."
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
          disabled={isBusy || executableApproved === 0}
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
        <SummaryCard
          label="Pendentes"
          value={pendingGroupCount}
          sub={summarySub(pendingGroupCount, query.data?.totals.proposed ?? 0)}
          tone="amber"
        />
        <SummaryCard
          label="Aprovadas"
          value={approvedGroupCount}
          sub={summarySub(approvedGroupCount, query.data?.totals.approved ?? 0)}
          tone="blue"
        />
        <SummaryCard label="Bloqueadas" value={blockedPendingCount} tone="red" />
        <SummaryCard label="Obsoletas" value={query.data?.totals.stale ?? 0} tone="slate" />
      </div>

      <SkuSummaryRail groups={grouped.resolvedGroups} unresolvedCount={grouped.unresolved.length} />

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-3 lg:grid-cols-8">
          <div className="lg:col-span-2">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              Busca
            </div>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="SKU, campanha, grupo ou termo"
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
          <FilterSelect
            label="Tipo campanha"
            value={campaignTypeFilter}
            onChange={setCampaignTypeFilter}
          >
            <option value="ALL">Todos</option>
            {campaignTypeOptions.map((value) => (
              <option key={value} value={value}>
                {campaignTypeLabel(value)}
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
            label="Correspondencia"
            value={matchTypeFilter}
            onChange={setMatchTypeFilter}
          >
            <option value="ALL">Todas</option>
            {matchTypeOptions.map((value) => (
              <option key={value} value={value}>
                {matchTypeLabel(value)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Tipo" value={entityTypeFilter} onChange={setEntityTypeFilter}>
            <option value="ALL">Todos</option>
            <option value="KEYWORD">Palavras-chave</option>
            <option value="TARGET">Segmentacoes</option>
            <option value="SEARCH_TERM">Termos pesquisados</option>
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
        <div className="grid gap-4">
          {grouped.resolvedGroups.map((group) => (
            <SkuGroupCard
              key={group.key}
              group={group}
              historyLabel={historyLabel}
              busy={isBusy}
              onApprove={(id, input) => approveMutation.mutate({ id, input })}
              onReject={(id) => rejectMutation.mutate(id)}
            />
          ))}
          {grouped.unresolved.length > 0 && (
            <UnresolvedPanel
              recommendations={grouped.unresolved}
              historyLabel={historyLabel}
              busy={isBusy}
              onReject={(id) => rejectMutation.mutate(id)}
            />
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {query.data?.lastRun ? (
          <span>
            Ultima rodada: {formatDateTime(query.data.lastRun.iniciadoEm)} |{" "}
            {query.data.lastRun.totalEntidades} entidades analisadas |{" "}
            {query.data.lastRun.totalRecomendacoes} acoes
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
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
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
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SkuSummaryRail({
  groups,
  unresolvedCount,
}: {
  groups: SkuGroup[];
  unresolvedCount: number;
}) {
  if (groups.length === 0 && unresolvedCount === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Resumo por SKU</p>
            <p className="text-sm text-muted-foreground">
              Priorize os SKUs com mais gasto, acoes criticas e oportunidades de termo.
            </p>
          </div>
          {unresolvedCount > 0 && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
              {unresolvedCount} sem atribuicao segura
            </Badge>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {groups.slice(0, 8).map((group) => (
            <div key={group.key} className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{group.sku}</p>
                  <p className="text-xs text-muted-foreground">
                    {plural(group.actionGroupCount, "grupo", "grupos")} |{" "}
                    {plural(group.proposedCount, "pendente", "pendentes")}
                  </p>
                </div>
                {group.criticalCount > 0 && (
                  <Badge className="border-transparent bg-red-600 text-white">
                    {group.criticalCount}
                  </Badge>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Fact label="Gasto afetado" value={formatBRL(group.totals30d.gastoCentavos)} />
                <Fact label="Vendas afetadas" value={formatBRL(group.totals30d.vendasCentavos)} />
                <Fact label="ACOS" value={formatPct(group.totals30d.acos)} />
              </div>
            </div>
          ))}
        </div>
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
                {historyLabel}. Este periodo alimenta as decisoes de keyword, segmentacao
                e termos pesquisados.
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
            title="Segmentacoes e palavras-chave"
            coverage={coverage.targeting}
            state={coverage.backfill.targeting}
          />
          <CoverageTile
            title="Termos pesquisados"
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
      <Select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </Select>
    </label>
  );
}

function SkuGroupCard({
  group,
  historyLabel,
  busy,
  onApprove,
  onReject,
}: {
  group: SkuGroup;
  historyLabel: string;
  busy: boolean;
  onApprove: (id: string, input: ApprovalInput) => void;
  onReject: (id: string) => void;
}) {
  const existing = group.recommendations.filter((rec) => rec.entityType !== "SEARCH_TERM");
  const opportunities = group.recommendations.filter((rec) => rec.entityType === "SEARCH_TERM");
  const defaultTab = existing.length > 0 ? "existing" : "opportunities";

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-slate-50">
                <Package className="mr-1 h-3.5 w-3.5" />
                SKU
              </Badge>
              {group.criticalCount > 0 && (
                <Badge className="border-transparent bg-red-600 text-white">
                  {plural(group.criticalCount, "critica", "criticas")}
                </Badge>
              )}
              {group.approvedCount > 0 && (
                <Badge className="border-transparent bg-blue-600 text-white">
                  {plural(group.approvedCount, "aprovada", "aprovadas")}
                </Badge>
              )}
            </div>
            <h2 className="mt-2 break-words text-xl font-semibold">{group.sku}</h2>
            <p className="text-sm text-muted-foreground">
              {group.asin ? `ASIN ${group.asin} | ` : ""}
              {plural(group.actionGroupCount, "grupo de acao", "grupos de acao")}
              {group.actionGroupCount !== group.recommendations.length
                ? ` | ${plural(group.recommendations.length, "item editavel", "itens editaveis")}`
                : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/25 p-3 text-sm sm:grid-cols-4">
            <Fact label="Gasto 30d afetado" value={formatBRL(group.totals30d.gastoCentavos)} />
            <Fact label="Vendas 30d afetadas" value={formatBRL(group.totals30d.vendasCentavos)} />
            <Fact label="Pedidos" value={String(group.totals30d.pedidos)} />
            <Fact label="ACOS" value={formatPct(group.totals30d.acos)} />
          </div>
        </div>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="existing">
              Ajustes existentes ({existing.length})
            </TabsTrigger>
            <TabsTrigger value="opportunities">
              Oportunidades de termos ({opportunities.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="existing" className="mt-4 grid gap-3">
            {existing.length > 0 ? (
              existing.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  historyLabel={historyLabel}
                  busy={busy}
                  onApprove={(input) => onApprove(rec.id, input)}
                  onReject={() => onReject(rec.id)}
                />
              ))
            ) : (
              <MiniEmpty text="Nenhum ajuste em keyword ou segmentacao para este SKU." />
            )}
          </TabsContent>
          <TabsContent value="opportunities" className="mt-4 grid gap-3">
            {opportunities.length > 0 ? (
              opportunities.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  historyLabel={historyLabel}
                  busy={busy}
                  onApprove={(input) => onApprove(rec.id, input)}
                  onReject={() => onReject(rec.id)}
                />
              ))
            ) : (
              <MiniEmpty text="Nenhum termo pesquisado novo para este SKU." />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function UnresolvedPanel({
  recommendations,
  historyLabel,
  busy,
  onReject,
}: {
  recommendations: Recommendation[];
  historyLabel: string;
  busy: boolean;
  onReject: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden border-amber-200">
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                Revisao estrutural
              </Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold">Campanhas sem atribuicao segura</h2>
            <p className="text-sm text-muted-foreground">
              A Amazon nao trouxe SKU direto e o ad group nao permite atribuir com 100% de
              seguranca. Estas acoes nao podem ser executadas automaticamente.
            </p>
          </div>
          <Badge variant="outline">{plural(recommendations.length, "acao", "acoes")}</Badge>
        </div>
        <div className="grid gap-3">
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              historyLabel={historyLabel}
              busy={busy}
              onApprove={() => undefined}
              onReject={() => onReject(rec.id)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
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
  onApprove: (input: ApprovalInput) => void;
  onReject: () => void;
}) {
  const canReject = rec.status === "PROPOSED" || rec.status === "APPROVED";
  const statusTone = rec.isExecutable ? "bg-background" : "bg-amber-50/30";

  return (
    <div className={cn("rounded-md border border-l-4 p-4", statusTone, severityBorderClass(rec.severity))}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={severityClass(rec.severity)}>
                {SEVERITY_LABEL[rec.severity]}
              </Badge>
              <Badge variant="outline">{STATUS_LABEL[rec.status] ?? rec.status}</Badge>
              <Badge variant="outline">{rec.displayEntityType}</Badge>
              {rec.matchType && (
                <Badge variant="outline">
                  {rec.entityType === "SEARCH_TERM"
                    ? `Origem ${matchTypeLabel(rec.matchType).toLowerCase()}`
                    : matchTypeLabel(rec.matchType)}
                </Badge>
              )}
              {rec.campaignTargetingType && (
                <Badge variant="outline">{campaignTypeLabel(rec.campaignTargetingType)}</Badge>
              )}
              {!rec.isExecutable && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                  Execucao bloqueada
                </Badge>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-700">
                {ACTION_LABEL[rec.actionType] ?? rec.actionType}
              </p>
              <h3 className="mt-1 break-words text-base font-semibold">
                {entityTitle(rec)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {rec.campaignName ?? "Campanha sem nome"}
                {rec.adGroupName ? ` | ${rec.adGroupName}` : ""}
                {rec.portfolioName ? ` | Portfolio ${rec.portfolioName}` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <RecommendationDetailsDialog rec={rec} historyLabel={historyLabel} />
            <Button
              size="sm"
              variant="outline"
              onClick={onReject}
              disabled={busy || !canReject}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Rejeitar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-2 text-sm">
            <p>{rec.motivo}</p>
            {(rec.blockedReason || rec.staleReason || rec.errorMessage) && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {rec.blockedReason ?? rec.staleReason ?? rec.errorMessage}
              </p>
            )}
          </div>
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <Fact label="Antes" value={beforeValue(rec)} />
            <Fact label="Depois" value={afterValue(rec)} />
            <Fact label="ACOS 30d" value={formatPct(rec.metrics30d.acos)} />
            <Fact label="Confianca" value={`${rec.confianca}%`} />
          </div>
        </div>

        <ApprovalPanel rec={rec} busy={busy} onApprove={onApprove} />
      </div>
    </div>
  );
}

function RecommendationDetailsDialog({
  rec,
  historyLabel,
}: {
  rec: Recommendation;
  historyLabel: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Eye className="mr-2 h-4 w-4" />
          Detalhes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entityTitle(rec)}</DialogTitle>
          <DialogDescription>
            Evidencias e dados tecnicos usados antes de aprovar a acao.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow label="Acao" value={ACTION_LABEL[rec.actionType] ?? rec.actionType} />
            <DetailRow label="Regra" value={rec.ruleId} />
            <DetailRow label="Tipo" value={rec.displayEntityType} />
            <DetailRow
              label="Correspondencia"
              value={rec.matchType ? matchTypeLabel(rec.matchType) : "-"}
            />
            <DetailRow label="Origem do SKU" value={skuSourceLabel(rec.skuAttributionSource)} />
            <DetailRow label="Campanha" value={rec.campaignName ?? rec.campaignId} />
            <DetailRow label="Grupo" value={rec.adGroupName ?? rec.adGroupId ?? "-"} />
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-semibold">Risco operacional</p>
            <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              <ShieldCheck className="mr-2 inline h-4 w-4 align-text-bottom" />
              {rec.risco}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <MetricsBlock label="7 dias" metrics={rec.metrics7d} />
            <MetricsBlock label="30 dias" metrics={rec.metrics30d} />
            <MetricsBlock label={historyLabel} metrics={rec.metricsLifetime} />
          </div>

          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-xs sm:grid-cols-2">
            <DetailRow label="Campaign ID" value={rec.campaignId} />
            <DetailRow label="Ad group ID" value={rec.adGroupId ?? "-"} />
            <DetailRow label="Keyword ID" value={rec.keywordId ?? "-"} />
            <DetailRow label="Target ID" value={rec.targetId ?? "-"} />
            <DetailRow label="Entity ID" value={rec.entityId} />
            <DetailRow label="Criada em" value={formatDateTime(rec.criadoEm)} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalPanel({
  rec,
  busy,
  onApprove,
}: {
  rec: Recommendation;
  busy: boolean;
  onApprove: (input: ApprovalInput) => void;
}) {
  const editableBid = rec.status === "PROPOSED" && rec.isExecutable && canEditBid(rec);
  const finalBidCentavos = rec.approvedBidCentavos ?? rec.proposedBidCentavos;
  const [bidInput, setBidInput] = React.useState(centavosToInput(finalBidCentavos));

  React.useEffect(() => {
    setBidInput(centavosToInput(finalBidCentavos));
  }, [finalBidCentavos, rec.id]);

  if (rec.status !== "PROPOSED") {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          <Fact label="Proposta original" value={afterValue({ ...rec, approvedBidCentavos: null })} />
          <Fact label="Aprovado para executar" value={afterValue(rec)} />
          <Fact label="Status" value={STATUS_LABEL[rec.status] ?? rec.status} />
        </div>
      </div>
    );
  }

  if (!rec.isExecutable) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">
          <AlertTriangle className="mr-2 inline h-4 w-4 align-text-bottom" />
          Esta acao precisa de revisao antes de executar.
        </p>
        <p>{rec.blockedReason ?? "O SKU nao foi atribuido com seguranca."}</p>
      </div>
    );
  }

  if (!editableBid) {
    return (
      <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">Resultado esperado: {afterValue(rec)}</p>
          <p className="text-muted-foreground">
            A acao sera executada somente depois de aprovada.
          </p>
        </div>
        <Button size="sm" onClick={() => onApprove({})} disabled={busy}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Aprovar acao
        </Button>
      </div>
    );
  }

  const parsedBid = parseBidInputCentavos(bidInput);
  const validBid = parsedBid != null && parsedBid > 0;

  return (
    <div className="rounded-md border bg-amber-50/50 p-3">
      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr_auto] lg:items-end">
        <div className="text-sm">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Proposta do sistema
          </p>
          <p className="font-semibold">{afterValue({ ...rec, approvedBidCentavos: null })}</p>
          <p className="text-xs text-muted-foreground">
            Lance atual: {formatMoneyOrDash(rec.currentBidCentavos)}
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Meu lance final para aprovar
          </span>
          <Input
            value={bidInput}
            onChange={(event) => setBidInput(event.target.value)}
            inputMode="decimal"
            placeholder="0,95"
          />
        </label>
        <Button
          size="sm"
          onClick={() => onApprove({ bidCentavos: parsedBid })}
          disabled={busy || !validBid}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Aprovar ajuste
        </Button>
      </div>
    </div>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value}</p>
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

function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function EmptyState({ hasData }: { hasData: boolean }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="text-sm font-medium">
          {hasData ? "Nenhuma acao nos filtros atuais." : "Nenhuma acao gerada."}
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

function groupRecommendations(recommendations: Recommendation[]) {
  const groups = new Map<string, Recommendation[]>();
  const unresolved: Recommendation[] = [];

  for (const rec of recommendations) {
    if (rec.skuAttributionStatus === "UNRESOLVED" || !rec.sku) {
      unresolved.push(rec);
      continue;
    }
    const current = groups.get(rec.sku) ?? [];
    current.push(rec);
    groups.set(rec.sku, current);
  }

  const resolvedGroups = [...groups.entries()]
    .map(([sku, items]) => ({
      key: sku,
      sku,
      asin: items.find((item) => item.asin)?.asin ?? null,
      recommendations: items,
      totals30d: aggregateMetrics(metricContributors(items).map((item) => item.metrics30d)),
      criticalCount: items.filter((item) => item.severity === "CRITICAL").length,
      approvedCount: items.filter((item) => item.status === "APPROVED").length,
      proposedCount: items.filter((item) => item.status === "PROPOSED").length,
      actionGroupCount: countActionGroups(items),
    }))
    .sort((a, b) => {
      if (b.criticalCount !== a.criticalCount) return b.criticalCount - a.criticalCount;
      return b.totals30d.gastoCentavos - a.totals30d.gastoCentavos;
    });

  return { resolvedGroups, unresolved };
}

function metricContributors(recommendations: Recommendation[]) {
  const parentRecommended = new Set(
    recommendations
      .filter((rec) => rec.entityType !== "SEARCH_TERM")
      .map(parentMetricKey),
  );
  const byMetricKey = new Map<string, Recommendation>();
  for (const rec of recommendations) {
    if (rec.entityType === "SEARCH_TERM" && parentRecommended.has(parentMetricKey(rec))) {
      continue;
    }
    const key = rec.entityType === "SEARCH_TERM" ? searchTermMetricKey(rec) : parentMetricKey(rec);
    if (!byMetricKey.has(key)) {
      byMetricKey.set(key, rec);
    }
  }
  return [...byMetricKey.values()];
}

function parentMetricKey(rec: Recommendation) {
  return [
    rec.campaignId,
    rec.adGroupId ?? "",
    rec.keywordId ?? rec.targetId ?? rec.entityId,
    rec.matchType ?? "",
  ].join("|");
}

function searchTermMetricKey(rec: Recommendation) {
  return [parentMetricKey(rec), normalizeDisplayText(rec.searchTerm ?? rec.displayLabel)].join("|");
}

function countActionGroups(recommendations: Recommendation[]) {
  return new Set(recommendations.map(actionGroupKey)).size;
}

function actionGroupKey(rec: Recommendation) {
  return [
    rec.sku ?? "",
    rec.campaignId,
    rec.adGroupId ?? "",
    rec.entityType,
    rec.actionType,
    normalizeDisplayText(rec.displayLabel || rec.label || rec.searchTerm || rec.entityId),
  ].join("|");
}

function normalizeDisplayText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function summarySub(groupCount: number, itemCount: number) {
  if (itemCount === 0) return "nenhum item";
  if (groupCount === itemCount) return "grupos de acao";
  return `${plural(itemCount, "item editavel", "itens editaveis")}`;
}

function aggregateMetrics(values: OptimizerMetrics[]): OptimizerMetrics {
  const base = values.reduce(
    (acc, item) => ({
      impressoes: acc.impressoes + item.impressoes,
      cliques: acc.cliques + item.cliques,
      gastoCentavos: acc.gastoCentavos + item.gastoCentavos,
      vendasCentavos: acc.vendasCentavos + item.vendasCentavos,
      pedidos: acc.pedidos + item.pedidos,
      unidades: acc.unidades + item.unidades,
    }),
    {
      impressoes: 0,
      cliques: 0,
      gastoCentavos: 0,
      vendasCentavos: 0,
      pedidos: 0,
      unidades: 0,
    },
  );
  return {
    ...base,
    acos: base.vendasCentavos > 0 ? base.gastoCentavos / base.vendasCentavos : null,
    roas: base.gastoCentavos > 0 ? base.vendasCentavos / base.gastoCentavos : null,
    ctr: base.impressoes > 0 ? base.cliques / base.impressoes : null,
    cpcCentavos: base.cliques > 0 ? Math.round(base.gastoCentavos / base.cliques) : null,
    conversao: base.cliques > 0 ? base.pedidos / base.cliques : null,
  };
}

function entityTitle(rec: Recommendation) {
  return rec.displayLabel || rec.label || rec.searchTerm || rec.entityId;
}

function beforeValue(rec: Recommendation) {
  if (rec.currentBidCentavos != null) return `Lance ${formatBRL(rec.currentBidCentavos)}`;
  return stateLabel(rec.beforeState);
}

function afterValue(rec: Recommendation) {
  const finalBid = rec.approvedBidCentavos ?? rec.proposedBidCentavos;
  if (finalBid != null) return `Lance ${formatBRL(finalBid)}`;
  return stateLabel(rec.proposedState);
}

function canEditBid(rec: Recommendation) {
  return (
    ["INCREASE_BID", "DECREASE_BID", "CREATE_EXACT_KEYWORD"].includes(rec.actionType) &&
    rec.proposedBidCentavos != null
  );
}

function centavosToInput(value: number | null) {
  return value == null ? "" : (value / 100).toFixed(2).replace(".", ",");
}

function parseBidInputCentavos(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function campaignTypeLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "auto") return "Automatica";
  if (normalized === "manual") return "Manual";
  return value;
}

function matchTypeLabel(value: string) {
  return MATCH_TYPE_LABEL[value.toUpperCase()] ?? value;
}

function stateLabel(value: string | null) {
  const normalized = value?.toLowerCase();
  if (normalized === "paused") return "Pausado";
  if (normalized === "enabled") return "Ativo";
  if (normalized === "archived") return "Arquivado";
  return value ?? "-";
}

function skuSourceLabel(value: string) {
  if (value === "REPORT") return "Relatorio Amazon";
  if (value === "SINGLE_ACTIVE_PRODUCT_AD") return "Product ad unico ativo";
  if (value === "UNRESOLVED_MULTI_SKU") return "Multiplos SKUs ativos";
  if (value === "UNRESOLVED_NO_ACTIVE_PRODUCT_AD") return "Sem product ad ativo";
  if (value === "UNRESOLVED_MISSING_AD_GROUP") return "Ad group ausente";
  return value;
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

function plural(count: number, singular: string, pluralValue: string) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
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
