"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Filter,
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
  busy,
  onApprove,
  onReject,
}: {
  rec: Recommendation;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const canReview = rec.status === "PROPOSED" || rec.status === "APPROVED";
  return (
    <Card className="overflow-hidden">
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
          <MetricsBlock label="Vitalicio" metrics={rec.metricsLifetime} />
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

function severityClass(severity: Recommendation["severity"]) {
  if (severity === "CRITICAL") return "border-transparent bg-red-600 text-white";
  if (severity === "HIGH") return "border-transparent bg-orange-600 text-white";
  if (severity === "MEDIUM") return "border-transparent bg-amber-500 text-white";
  return "border-transparent bg-emerald-600 text-white";
}
