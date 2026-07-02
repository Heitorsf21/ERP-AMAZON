"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  Filter,
  History,
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
import { ProductThumb } from "@/components/ui/product-thumb";
import { InvestimentoPorProduto } from "@/components/publicidade/investimento-por-produto";
import { resolverImagemProduto } from "@/lib/amazon-images";
import {
  FUNNEL_OBSERVATION_MIN_CLICKS,
  FUNNEL_OBSERVATION_MIN_DAYS,
} from "@/modules/ads-optimizer/funnel-params";

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

type SkuAttributionCandidate = { adId: string; sku: string; asin: string | null };

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
  skuAttributionCandidates: SkuAttributionCandidate[];
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
  metrics65d: OptimizerMetrics | null;
  metricsLifetime: OptimizerMetrics;
  criadoEm: string;
  aprovadoEm: string | null;
  executadoEm: string | null;
  staleReason: string | null;
  errorMessage: string | null;
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
  ultimaAcao: { actionType: string; status: string; criadoEm: string } | null;
};

type Observation = {
  recommendationId: string;
  sku: string | null;
  skuAttributionCandidates: SkuAttributionCandidate[];
  displayLabel: string;
  actionType: string;
  executadoEm: string;
  diasDesdeMudanca: number;
  cliquesPosMudanca: number;
  baselineAcos: number | null;
  postChange: OptimizerMetrics;
  madura: boolean;
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
  coverage: unknown;
  observations: Observation[];
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
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
  ultimaAcao: Recommendation["ultimaAcao"];
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

function AdsOptimizerPageInner() {
  const queryClient = useQueryClient();
  // Deep-link das notificações (ACOS alto → /publicidade/otimizador?sku=SKU):
  // pré-seleciona o produto no painel de investimento.
  const searchParams = useSearchParams();
  const skuInicial = searchParams.get("sku");
  const [skuSelecionado, setSkuSelecionado] = React.useState<string | null>(
    skuInicial || null,
  );
  // Navegação client-side para outro ?sku= (ex: clicar em outra notificação
  // com o app aberto) precisa re-selecionar — useState só inicializa uma vez.
  React.useEffect(() => {
    if (skuInicial) setSkuSelecionado(skuInicial);
  }, [skuInicial]);
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

  const recommendations = React.useMemo(
    () => query.data?.recommendations ?? [],
    [query.data],
  );
  const historyLabel = "Historico disponivel";
  // Contagem de pendentes por SKU para os badges do painel de investimento.
  // Recomendações de ad group compartilhado contam para cada produto candidato.
  const recPendentesPorSku = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const rec of recommendations) {
      if (rec.status !== "PROPOSED") continue;
      for (const sku of skusAtribuidos(rec)) {
        map.set(sku, (map.get(sku) ?? 0) + 1);
      }
    }
    return map;
  }, [recommendations]);
  const observations = React.useMemo(
    () => query.data?.observations ?? [],
    [query.data],
  );
  const obsPorSku = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const obs of observations) {
      for (const sku of skusAtribuidos(obs)) {
        map.set(sku, (map.get(sku) ?? 0) + 1);
      }
    }
    return map;
  }, [observations]);
  const obsDoProduto = React.useMemo(
    () =>
      skuSelecionado
        ? observations.filter((obs) => pertenceAoSku(obs, skuSelecionado))
        : [],
    [observations, skuSelecionado],
  );
  const obsSemSku = React.useMemo(
    () => observations.filter((obs) => skusAtribuidos(obs).length === 0),
    [observations],
  );
  // Pendências realmente órfãs (sem SKU nem candidatos) — rodapé da pizza.
  // As de ad group compartilhado aparecem sob cada produto candidato.
  const unresolvedPendentes = React.useMemo(
    () =>
      recommendations.filter(
        (rec) => rec.status === "PROPOSED" && skusAtribuidos(rec).length === 0,
      ),
    [recommendations],
  );
  const filtered = recommendations.filter((rec) => {
    // Seleção de produto no donut: foca as recomendações daquele SKU
    // (incluindo as compartilhadas em que ele é um dos candidatos).
    if (skuSelecionado && !pertenceAoSku(rec, skuSelecionado)) return false;
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
  const grouped = React.useMemo(
    () => groupRecommendations(filtered, skuSelecionado),
    [filtered, skuSelecionado],
  );
  const isBusy =
    runMutation.isPending ||
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
          variant="ghost"
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={isBusy}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", runMutation.isPending && "animate-spin")} />
          Atualizar agora
        </Button>
        <Button
          size="sm"
          onClick={() => executeMutation.mutate()}
          disabled={isBusy || executableApproved === 0}
        >
          <Play className="mr-2 h-4 w-4" />
          Executar aprovadas
          {executableApproved > 0 && (
            <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs tabular-nums">
              {executableApproved}
            </span>
          )}
        </Button>
      </PageHeader>

      <InvestimentoPorProduto
        skuSelecionado={skuSelecionado}
        onSelecionar={setSkuSelecionado}
        recPendentesPorSku={recPendentesPorSku}
        obsPorSku={obsPorSku}
        rodape={
          unresolvedPendentes.length > 0 || obsSemSku.length > 0 ? (
            <details className="mt-4 rounded-md border border-dashed bg-muted/30">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  {unresolvedPendentes.length > 0 &&
                    `${unresolvedPendentes.length} recomendaç${unresolvedPendentes.length === 1 ? "ão" : "ões"} sem produto identificado (revisão manual)`}
                  {unresolvedPendentes.length > 0 && obsSemSku.length > 0 && " · "}
                  {obsSemSku.length > 0 &&
                    `${obsSemSku.length} em observação sem produto`}
                </span>
                <span className="underline underline-offset-2">ver</span>
              </summary>
              <div className="space-y-3 px-3.5 pb-3.5 pt-1">
                <ObservacaoPanel
                  observations={obsSemSku}
                  titulo="Em observação (sem produto identificado)"
                />
                {unresolvedPendentes.length > 0 && (
                  <UnresolvedPanel
                    recommendations={unresolvedPendentes}
                    historyLabel={historyLabel}
                    busy={isBusy}
                    onReject={(id) => rejectMutation.mutate(id)}
                  />
                )}
              </div>
            </details>
          ) : undefined
        }
      />

      {/* Detalhes do produto: observação + filtros + recomendações — só com seleção */}
      {skuSelecionado && (
        <ObservacaoPanel observations={obsDoProduto} />
      )}

      {skuSelecionado && (
      <>
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
        <EmptyState
          hasData={recommendations.length > 0}
          skuSelecionado={skuSelecionado}
        />
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
        </div>
      )}
      </>
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

export default function AdsOptimizerPage() {
  return (
    <React.Suspense fallback={<div className="h-40 rounded-xl border bg-card" />}>
      <AdsOptimizerPageInner />
    </React.Suspense>
  );
}

/**
 * "Em observação" redesenhado: uma linha com a essência (o quê + qual mudança
 * + efeito no ACoS) e uma barra de maturação. Detalhes (gasto/vendas/cliques
 * desde a mudança) ficam num expand por item.
 */
function ObservacaoPanel({
  observations,
  titulo = "Em observação neste produto",
}: {
  observations: Observation[];
  titulo?: string;
}) {
  if (observations.length === 0) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {titulo}
          </p>
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-blue-700 dark:text-blue-400">
            {observations.length}
          </span>
        </div>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          Mudanças já aplicadas — o sistema segura novos ajustes até o efeito
          amadurecer.
        </p>
        <div className="space-y-2.5">
          {observations.map((obs) => (
            <ObservacaoItem key={obs.recommendationId} obs={obs} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ObservacaoItem({ obs }: { obs: Observation }) {
  const acosAntes = obs.baselineAcos != null ? obs.baselineAcos * 100 : null;
  const acosAgora =
    obs.postChange.acos != null ? obs.postChange.acos * 100 : null;
  const temEfeito = acosAntes != null && acosAgora != null;
  const delta = temEfeito ? acosAgora - acosAntes : null;
  const melhorou = delta != null && delta < -0.5;
  const piorou = delta != null && delta > 0.5;

  const progDias = Math.min(
    obs.diasDesdeMudanca / FUNNEL_OBSERVATION_MIN_DAYS,
    1,
  );
  const progCliques = Math.min(
    obs.cliquesPosMudanca / FUNNEL_OBSERVATION_MIN_CLICKS,
    1,
  );
  const progresso = obs.madura ? 1 : Math.min(progDias, progCliques);

  return (
    <details className="rounded-lg border bg-muted/20">
      <summary className="cursor-pointer list-none px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-sm font-medium">“{obs.displayLabel}”</span>
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
            {ACTION_LABEL[obs.actionType] ?? obs.actionType}
          </span>
          {!obs.sku && obs.skuAttributionCandidates.length > 1 && (
            <span
              className="rounded-full border border-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:border-blue-900 dark:text-blue-400"
              title={`Ad group anuncia: ${obs.skuAttributionCandidates.map((candidate) => candidate.sku).join(", ")}`}
            >
              {obs.skuAttributionCandidates.length} produtos
            </span>
          )}
          <span className="ml-auto text-right">
            {temEfeito ? (
              <>
                <span className="mr-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  ACoS
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {acosAntes.toFixed(0)}%
                </span>{" "}
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    melhorou && "text-emerald-600 dark:text-emerald-400",
                    piorou && "text-red-600 dark:text-red-400",
                    !melhorou && !piorou && "text-muted-foreground",
                  )}
                >
                  {melhorou ? "▼" : piorou ? "▲" : "→"} {acosAgora.toFixed(0)}%
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                sem cliques suficientes ainda
              </span>
            )}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                obs.madura ? "bg-emerald-500" : "bg-blue-500",
              )}
              style={{ width: `${Math.round(progresso * 100)}%` }}
            />
          </div>
          <span
            className={cn(
              "shrink-0 text-[11px]",
              obs.madura
                ? "font-medium text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {obs.madura
              ? "✓ Dado maduro — pronto para o próximo passo"
              : `amadurecendo · ${obs.diasDesdeMudanca}/${FUNNEL_OBSERVATION_MIN_DAYS} dias · ${obs.cliquesPosMudanca}/${FUNNEL_OBSERVATION_MIN_CLICKS} cliques`}
          </span>
        </div>
      </summary>
      <div className="border-t px-3.5 pb-3 pt-2">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Fact
            label="Gasto desde"
            value={formatBRL(obs.postChange.gastoCentavos)}
          />
          <Fact
            label="Vendas desde"
            value={formatBRL(obs.postChange.vendasCentavos)}
          />
          <Fact label="Cliques desde" value={String(obs.cliquesPosMudanca)} />
        </div>
        {!obs.madura && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Conversões da Amazon ainda entrando (janela de atribuição de ~7
            dias).
          </p>
        )}
      </div>
    </details>
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
          <div className="flex min-w-0 gap-3">
            <ProductThumb
              src={resolverImagemProduto(group.amazonImagemUrl, group.asin, group.imagemUrl)}
              alt={group.sku}
              size={56}
            />
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
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/25 p-3 text-sm sm:grid-cols-4">
            <Fact label="Gasto 30d afetado" value={formatBRL(group.totals30d.gastoCentavos)} />
            <Fact label="Vendas 30d afetadas" value={formatBRL(group.totals30d.vendasCentavos)} />
            <Fact label="Pedidos" value={String(group.totals30d.pedidos)} />
            <Fact label="ACOS" value={formatPct(group.totals30d.acos)} />
          </div>
        </div>

        {group.ultimaAcao && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
            <History className="h-3.5 w-3.5 shrink-0" />
            <span>
              Última ação neste SKU:{" "}
              <strong>{ACTION_LABEL[group.ultimaAcao.actionType] ?? group.ultimaAcao.actionType}</strong>{" "}
              — {STATUS_LABEL[group.ultimaAcao.status as RecommendationStatus] ?? group.ultimaAcao.status}{" "}
              ({formatDateTime(group.ultimaAcao.criadoEm)})
            </span>
          </div>
        )}

        <Tabs defaultValue={defaultTab}>
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="existing">
              Ajustes existentes ({existing.length})
            </TabsTrigger>
            <TabsTrigger value="opportunities">
              Oportunidades de termos ({opportunities.length})
            </TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
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
          <TabsContent value="history" className="mt-4">
            <HistoricoSku sku={group.sku} />
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
              {!rec.sku && rec.skuAttributionCandidates.length > 1 && (
                <Badge
                  variant="outline"
                  className="border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200"
                  title={`Ad group anuncia: ${rec.skuAttributionCandidates.map((candidate) => candidate.sku).join(", ")}`}
                >
                  Vale para {rec.skuAttributionCandidates.length} produtos
                </Badge>
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
            {rec.skuAttributionCandidates.length > 1 && (
              <DetailRow
                label="Produtos do ad group"
                value={rec.skuAttributionCandidates.map((candidate) => candidate.sku).join(", ")}
              />
            )}
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

          <div
            className={cn(
              "grid gap-2",
              rec.metrics65d ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3",
            )}
          >
            <MetricsBlock label="7 dias" metrics={rec.metrics7d} />
            <MetricsBlock label="30 dias" metrics={rec.metrics30d} />
            {rec.metrics65d && <MetricsBlock label="65 dias" metrics={rec.metrics65d} />}
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

type HistoryEntry = {
  id: string;
  status: RecommendationStatus;
  entityType: string;
  displayEntityType: string;
  displayLabel: string;
  actionType: string;
  severity: Recommendation["severity"];
  confianca: number;
  motivo: string;
  risco: string | null;
  currentBidCentavos: number | null;
  proposedBidCentavos: number | null;
  approvedBidCentavos: number | null;
  metrics7d: OptimizerMetrics;
  metrics30d: OptimizerMetrics;
  criadoEm: string;
  aprovadoEm: string | null;
  aprovadoPorEmail: string | null;
  rejeitadoEm: string | null;
  rejeitadoPorEmail: string | null;
  executadoEm: string | null;
  staleReason: string | null;
  errorMessage: string | null;
  execucoes: Array<{
    status: string;
    errorMessage: string | null;
    executadoEm: string;
    executadoPorEmail: string | null;
  }>;
};

type HistoryResponse = { sku: string; total: number; history: HistoryEntry[] };

function HistoricoSku({ sku }: { sku: string }) {
  const query = useQuery<HistoryResponse>({
    queryKey: ["ads-optimizer-history", sku],
    queryFn: () =>
      fetchJSON<HistoryResponse>(
        `/api/ads/optimizer/history?sku=${encodeURIComponent(sku)}`,
      ),
    staleTime: 30_000,
  });

  if (query.isLoading) return <Skeleton className="h-32 rounded-md" />;
  const history = query.data?.history ?? [];
  if (history.length === 0) {
    return <MiniEmpty text="Nenhuma acao registrada para este SKU ainda." />;
  }
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {history.map((entry) => (
        <HistoricoEntry key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}

function HistoricoEntry({ entry }: { entry: HistoryEntry }) {
  const [aberto, setAberto] = React.useState(false);
  const finalBid = entry.approvedBidCentavos ?? entry.proposedBidCentavos;
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 border-background",
          historyDotClass(entry.status),
        )}
      />
      <button
        type="button"
        onClick={() => setAberto((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-[88px] shrink-0 text-xs text-muted-foreground">
          {formatDateTime(entry.criadoEm)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {ACTION_LABEL[entry.actionType] ?? entry.actionType} ·{" "}
          <span className="font-medium">{entry.displayLabel}</span>
        </span>
        <Badge variant="outline" className={historyBadgeClass(entry.status)}>
          {STATUS_LABEL[entry.status] ?? entry.status}
        </Badge>
        {aberto ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      {aberto && (
        <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
          <HistFact
            label="Proposta do sistema"
            value={`${historyBeforeBid(entry)} → ${historyAfterBid(finalBid)} · severidade ${
              SEVERITY_LABEL[entry.severity] ?? entry.severity
            } · confianca ${entry.confianca}%`}
          />
          <HistFact label="Por que" value={entry.motivo} />
          {entry.risco && <HistFact label="Risco" value={entry.risco} />}
          <HistFact
            label="Metricas no momento"
            value={`7d: gasto ${formatBRL(entry.metrics7d.gastoCentavos)} · ACOS ${formatPct(
              entry.metrics7d.acos,
            )} | 30d: gasto ${formatBRL(entry.metrics30d.gastoCentavos)} · ACOS ${formatPct(
              entry.metrics30d.acos,
            )}`}
          />
          <HistFact label="Sua decisao" value={historyDecisionLabel(entry, finalBid)} />
          <HistFact label="Resultado" value={historyResultLabel(entry)} />
        </div>
      )}
    </li>
  );
}

function HistFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <span className="text-[11px] uppercase text-muted-foreground">{label}</span>
      <span className="break-words text-foreground">{value}</span>
    </div>
  );
}

function historyBeforeBid(entry: HistoryEntry) {
  return entry.currentBidCentavos != null ? `Lance ${formatBRL(entry.currentBidCentavos)}` : "-";
}

function historyAfterBid(finalBid: number | null) {
  return finalBid != null ? `Lance ${formatBRL(finalBid)}` : "-";
}

function historyDecisionLabel(entry: HistoryEntry, finalBid: number | null) {
  if (entry.aprovadoEm) {
    const ajuste =
      finalBid != null &&
      entry.proposedBidCentavos != null &&
      finalBid !== entry.proposedBidCentavos
        ? ` (ajustado de ${formatBRL(entry.proposedBidCentavos)})`
        : "";
    return `Aprovado${finalBid != null ? ` com ${formatBRL(finalBid)}` : ""}${ajuste} · ${formatDateTime(
      entry.aprovadoEm,
    )}${entry.aprovadoPorEmail ? ` · ${entry.aprovadoPorEmail}` : ""}`;
  }
  if (entry.rejeitadoEm) {
    return `Rejeitado · ${formatDateTime(entry.rejeitadoEm)}${
      entry.rejeitadoPorEmail ? ` · ${entry.rejeitadoPorEmail}` : ""
    }`;
  }
  return STATUS_LABEL[entry.status] ?? entry.status;
}

function historyResultLabel(entry: HistoryEntry) {
  if (entry.executadoEm) return `Aplicada na Amazon · ${formatDateTime(entry.executadoEm)}`;
  const erroExec = entry.execucoes.find((e) => e.errorMessage)?.errorMessage ?? entry.errorMessage;
  if (entry.status === "FAILED") return `Falhou${erroExec ? `: ${erroExec}` : ""}`;
  if (entry.status === "STALE") return `Obsoleta${entry.staleReason ? `: ${entry.staleReason}` : ""}`;
  if (entry.status === "REJECTED") return "Nao aplicada (rejeitada)";
  return "-";
}

function historyDotClass(status: RecommendationStatus) {
  if (status === "APPLIED") return "bg-emerald-500";
  if (status === "APPROVED") return "bg-blue-500";
  if (status === "REJECTED") return "bg-red-500";
  if (status === "FAILED") return "bg-orange-500";
  return "bg-slate-400";
}

function historyBadgeClass(status: RecommendationStatus) {
  if (status === "APPLIED") return "border-emerald-300 text-emerald-700";
  if (status === "REJECTED") return "border-red-300 text-red-700";
  if (status === "FAILED") return "border-orange-300 text-orange-700";
  return "";
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

function EmptyState({
  hasData,
  skuSelecionado,
}: {
  hasData: boolean;
  skuSelecionado?: string | null;
}) {
  if (skuSelecionado) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm font-medium">
            Nenhuma recomendação pendente para este produto.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            O funil está observando as campanhas dele — novas ações aparecem
            aqui. Confira também os filtros de status acima.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="text-sm font-medium">
          {hasData ? "Nenhuma ação nos filtros atuais." : "Nenhuma ação pendente — tudo otimizado."}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasData
            ? "Ajuste os filtros para ver outras ações."
            : "O ciclo automático roda a cada 6 horas. Quando houver algo a decidir, aparece aqui."}
        </p>
      </CardContent>
    </Card>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

// SKUs aos quais um item pertence: o atribuído diretamente, ou — em ad group
// com mais de um produto ativo — todos os candidatos do ad group.
function skusAtribuidos(item: {
  sku: string | null;
  skuAttributionCandidates: SkuAttributionCandidate[];
}): string[] {
  if (item.sku) return [item.sku];
  return [...new Set(item.skuAttributionCandidates.map((candidate) => candidate.sku))];
}

function pertenceAoSku(
  item: { sku: string | null; skuAttributionCandidates: SkuAttributionCandidate[] },
  sku: string,
): boolean {
  return skusAtribuidos(item).includes(sku);
}

function groupRecommendations(
  recommendations: Recommendation[],
  skuSelecionado: string | null,
) {
  const groups = new Map<string, Recommendation[]>();
  const unresolved: Recommendation[] = [];

  for (const rec of recommendations) {
    if (rec.skuAttributionStatus !== "UNRESOLVED" && rec.sku) {
      const current = groups.get(rec.sku) ?? [];
      current.push(rec);
      groups.set(rec.sku, current);
      continue;
    }
    // Ad group compartilhado: com um produto selecionado que seja candidato,
    // a recomendação entra no grupo dele (a ação keyword-level vale para todos).
    if (skuSelecionado && pertenceAoSku(rec, skuSelecionado)) {
      const current = groups.get(skuSelecionado) ?? [];
      current.push(rec);
      groups.set(skuSelecionado, current);
      continue;
    }
    unresolved.push(rec);
  }

  const resolvedGroups = [...groups.entries()]
    .map(([sku, items]) => ({
      key: sku,
      sku,
      asin:
        items.find((item) => item.asin)?.asin ??
        items
          .flatMap((item) => item.skuAttributionCandidates)
          .find((candidate) => candidate.sku === sku)?.asin ??
        null,
      recommendations: items,
      totals30d: aggregateMetrics(metricContributors(items).map((item) => item.metrics30d)),
      criticalCount: items.filter((item) => item.severity === "CRITICAL").length,
      approvedCount: items.filter((item) => item.status === "APPROVED").length,
      proposedCount: items.filter((item) => item.status === "PROPOSED").length,
      actionGroupCount: countActionGroups(items),
      imagemUrl: items.find((item) => item.imagemUrl)?.imagemUrl ?? null,
      amazonImagemUrl: items.find((item) => item.amazonImagemUrl)?.amazonImagemUrl ?? null,
      ultimaAcao: items.find((item) => item.ultimaAcao)?.ultimaAcao ?? null,
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
  if (value === "UNRESOLVED_MULTI_SKU") return "Compartilhado (ad group com varios produtos)";
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
