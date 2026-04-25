"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Hash,
  MessageSquare,
  PackageOpen,
  RefreshCw,
  Send,
  Server,
  TriangleAlert,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type AutomationConfig = {
  automacaoAtiva: boolean;
  ultimaExecucao: string | null;
};

type ReviewMetrics = {
  pedidos30d: number;
  naFila: number;
  tentadosHoje: number;
  enviadosHoje: number;
  elegiveisHoje: number;
  enviadasHoje: number;
  enviadas7d: number;
  enviadas30d: number;
  jaSolicitados: number;
  adiadosAmanha: number;
  expirados: number;
  errosReais: number;
  erros7d: number;
  totalEnviadas: number;
};

type ReviewSolicitation = {
  id: string;
  amazonOrderId: string;
  status: string;
  asin: string | null;
  sku: string | null;
  orderCreatedAt: string | null;
  nextCheckAt: string | null;
  attempts: number;
  qualificationReason: string | null;
  resolvedReason: string | null;
  checkedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProdutoToggle = {
  id: string;
  sku: string;
  asin: string | null;
  nome: string;
  imagemUrl: string | null;
  solicitarReviewsAtivo: boolean;
  totalEnviadas: number;
  ultimaEnvioEm: string | null;
};

type HealthStatus = {
  worker?: { lastHeartbeatAt: string | null; ageSec: number | null; ok: boolean };
};

const STATUS_META: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "muted" | "info" }
> = {
  PENDENTE: { label: "Pendente", tone: "muted" },
  AGUARDANDO: { label: "Aguardando", tone: "info" },
  ELEGIVEL: { label: "Elegível", tone: "info" },
  ENVIADO: { label: "Enviado", tone: "success" },
  JA_SOLICITADO: { label: "Já solicitado", tone: "success" },
  NAO_ELEGIVEL: { label: "Não elegível", tone: "muted" },
  EXPIRADO: { label: "Expirado", tone: "warning" },
  ERRO: { label: "Erro", tone: "danger" },
};

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "ALL", label: "Todos" },
  { key: "ENVIADO", label: "Enviados" },
  { key: "AGUARDANDO", label: "Aguardando" },
  { key: "ELEGIVEL", label: "Elegíveis" },
  { key: "ERRO", label: "Erros" },
  { key: "EXPIRADO", label: "Expirados" },
];

function ReviewStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "muted" as const };
  const variants: Record<typeof meta.tone, string> = {
    success: "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20",
    danger: "bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20",
    info: "bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20",
    muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
        variants[meta.tone],
      )}
    >
      {meta.label}
    </span>
  );
}

function StatusDot({ tone }: { tone: "success" | "warning" | "danger" | "muted" | "info" }) {
  const colors: Record<typeof tone, string> = {
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-rose-500",
    info: "bg-sky-500",
    muted: "bg-muted-foreground/40",
  };
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", colors[tone])} />;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(value: string | null) {
  if (!value) return null;
  return formatDistanceToNow(new Date(value), { locale: ptBR, addSuffix: true });
}

function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const tones: Record<typeof tone, string> = {
    default: "border-border bg-card",
    success: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    danger: "border-rose-500/30 bg-rose-500/5",
  };

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border p-4", tones[tone])}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground/70" />
      </div>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export default function AvaliacoesPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");

  const { data: config, isLoading: loadingConfig } = useQuery<AutomationConfig>({
    queryKey: ["reviews-config"],
    queryFn: () => fetchJSON<AutomationConfig>("/api/amazon/reviews/config"),
  });

  const { data: metricas } = useQuery<ReviewMetrics>({
    queryKey: ["reviews-metricas"],
    queryFn: () => fetchJSON<ReviewMetrics>("/api/amazon/reviews/metricas"),
    refetchInterval: 15_000,
  });

  const { data: reviews = [], isLoading: loadingReviews } = useQuery<
    ReviewSolicitation[]
  >({
    queryKey: ["reviews-historico"],
    queryFn: () => fetchJSON<ReviewSolicitation[]>("/api/amazon/reviews"),
    refetchInterval: 15_000,
  });

  const { data: produtos = [], isLoading: loadingProdutos } = useQuery<
    ProdutoToggle[]
  >({
    queryKey: ["reviews-produtos"],
    queryFn: () => fetchJSON<ProdutoToggle[]>("/api/amazon/reviews/produtos"),
  });

  const { data: health } = useQuery<HealthStatus>({
    queryKey: ["health-worker"],
    queryFn: () => fetchJSON<HealthStatus>("/api/health"),
    refetchInterval: 20_000,
  });

  const toggleAutomacao = useMutation({
    mutationFn: (ativo: boolean) =>
      fetchJSON<AutomationConfig>("/api/amazon/reviews/config", {
        method: "PATCH",
        body: JSON.stringify({ automacaoAtiva: ativo }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["reviews-config"], data);
      toast.success(
        data.automacaoAtiva
          ? "Automação ativada — o worker passará a enfileirar checagens."
          : "Automação desativada — o worker para as checagens periódicas.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const toggleProduto = useMutation({
    mutationFn: (payload: { produtoId: string; ativo: boolean }) =>
      fetchJSON("/api/amazon/reviews/produtos", {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onMutate: async ({ produtoId, ativo }) => {
      await qc.cancelQueries({ queryKey: ["reviews-produtos"] });
      const anterior = qc.getQueryData<ProdutoToggle[]>(["reviews-produtos"]);
      qc.setQueryData<ProdutoToggle[]>(["reviews-produtos"], (old) =>
        old?.map((p) =>
          p.id === produtoId ? { ...p, solicitarReviewsAtivo: ativo } : p,
        ),
      );
      return { anterior };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.anterior) qc.setQueryData(["reviews-produtos"], ctx.anterior);
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar produto");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["reviews-produtos"] });
    },
  });

  const automacaoAtiva = config?.automacaoAtiva ?? false;
  const workerOk = health?.worker?.ok ?? false;
  const workerAge = health?.worker?.ageSec ?? null;
  const workerHeartbeat = health?.worker?.lastHeartbeatAt ?? null;

  const ultimaExecucaoRel = formatRelative(config?.ultimaExecucao ?? null);
  const ultimaExecucaoAbs = formatDateTime(config?.ultimaExecucao ?? null);

  const pausadosCount = produtos.filter((p) => !p.solicitarReviewsAtivo).length;
  const ativosCount = produtos.length - pausadosCount;

  const filteredReviews =
    statusFilter === "ALL"
      ? reviews
      : reviews.filter((r) => r.status === statusFilter);

  const headerStatus = !automacaoAtiva
    ? { label: "Automação desativada", tone: "muted" as const }
    : workerOk
      ? { label: "Automação ativa · worker online", tone: "success" as const }
      : { label: "Automação ativa · worker offline", tone: "warning" as const };

  function exportarReviewsCSV(data: ReviewSolicitation[]) {
    const linhas = [
      ["Pedido Amazon", "SKU", "ASIN", "Status", "Criado em", "Enviado em", "Tentativas", "Razão"],
      ...data.map((r) => [
        r.amazonOrderId,
        r.sku ?? "",
        r.asin ?? "",
        r.status,
        formatDateTime(r.orderCreatedAt),
        formatDateTime(r.sentAt),
        String(r.attempts),
        r.qualificationReason ?? r.resolvedReason ?? r.errorMessage ?? "",
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `avaliacoes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitação de Avaliações"
        description="Automação contínua de pedidos de review no Amazon Seller Central via SP-API."
      >
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
            headerStatus.tone === "success" &&
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
            headerStatus.tone === "warning" &&
              "border-amber-500/30 bg-amber-500/10 text-amber-700",
            headerStatus.tone === "muted" &&
              "border-border bg-muted text-muted-foreground",
          )}
        >
          <StatusDot tone={headerStatus.tone === "muted" ? "muted" : headerStatus.tone} />
          {headerStatus.label}
        </div>
      </PageHeader>

      {/* Card automação */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Automação contínua</h3>
                <p className="text-xs text-muted-foreground">
                  Enquanto este toggle estiver ativo e o worker em execução, o
                  sistema enfileira <code className="rounded bg-muted px-1 py-0.5 text-[10px]">REVIEWS_DISCOVERY</code> a cada 6h e <code className="rounded bg-muted px-1 py-0.5 text-[10px]">REVIEWS_SEND</code> a cada 1h.
                  Ao desativar, novas checagens param imediatamente — o histórico permanece.
                </p>
              </div>
              <Switch
                checked={automacaoAtiva}
                disabled={loadingConfig || toggleAutomacao.isPending}
                onCheckedChange={(v) => toggleAutomacao.mutate(v)}
                aria-label="Ativar automação contínua de avaliações"
                className="mt-1"
              />
            </div>

            {automacaoAtiva && !workerOk && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  A automação está ligada, mas o worker não está respondendo
                  (heartbeat &gt; 5min). Confira <code className="rounded bg-amber-500/10 px-1">npm run amazon:worker</code> ou o PM2 no servidor.
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-px bg-border lg:border-l">
            <div className="flex flex-col gap-2 bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Server className="h-3.5 w-3.5" /> Worker
              </div>
              <div className="flex items-center gap-2">
                <StatusDot tone={workerOk ? "success" : "danger"} />
                <span className="text-sm font-semibold">
                  {workerOk ? "Online" : workerHeartbeat ? "Offline" : "Sem heartbeat"}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {workerHeartbeat
                  ? `Heartbeat ${formatRelative(workerHeartbeat)}`
                  : "Aguardando worker iniciar"}
                {workerAge !== null && workerOk ? ` · ${workerAge}s atrás` : ""}
              </span>
            </div>
            <div className="flex flex-col gap-2 bg-card p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Última execução
              </div>
              <span className="text-sm font-semibold">
                {ultimaExecucaoRel ?? "Nunca executada"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {config?.ultimaExecucao ? ultimaExecucaoAbs : "—"}
                {pausadosCount > 0 && ` · ${pausadosCount} SKU(s) pausado(s)`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Pedidos 30d"
          value={metricas?.pedidos30d ?? "—"}
          hint={metricas ? `${metricas.naFila} na fila` : undefined}
          icon={CheckCircle2}
          tone="default"
        />
        <KpiCard
          label="Sucesso (30 dias)"
          value={metricas?.enviadas30d ?? "—"}
          hint={
            metricas
              ? `${metricas.totalEnviadas} no total · ${metricas.enviadas7d} em 7d`
              : undefined
          }
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label="Enviadas hoje"
          value={metricas?.enviadosHoje ?? metricas?.enviadasHoje ?? "—"}
          hint={metricas ? `${metricas.tentadosHoje} tentados hoje` : undefined}
          icon={Send}
          tone="success"
        />
        <KpiCard
          label="Adiados"
          value={metricas?.adiadosAmanha ?? "—"}
          hint={metricas ? `${metricas.jaSolicitados} já solicitados` : undefined}
          icon={MessageSquare}
        />
        <KpiCard
          label="Erros"
          value={metricas?.errosReais ?? "—"}
          hint={metricas ? `${metricas.expirados} expirados` : undefined}
          icon={TriangleAlert}
          tone={metricas && metricas.errosReais > 0 ? "danger" : "default"}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="historico">
        <TabsList>
          <TabsTrigger value="historico">Geral & Histórico</TabsTrigger>
          <TabsTrigger value="produtos">
            Por Produto
            {produtos.length > 0 && (
              <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
                {ativosCount}/{produtos.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="historico" className="mt-4 space-y-4">
          <div className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">Histórico de solicitações</h3>
                <p className="text-xs text-muted-foreground">
                  {filteredReviews.length} de {reviews.length} solicitações
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted p-0.5">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setStatusFilter(f.key)}
                      className={cn(
                        "rounded px-2 py-1 text-[11px] font-medium transition",
                        statusFilter === f.key
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Exportar CSV"
                  disabled={!reviews.length}
                  onClick={() => exportarReviewsCSV(filteredReviews)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    qc.invalidateQueries({ queryKey: ["reviews-historico"] })
                  }
                  className="gap-1 text-xs"
                >
                  <RefreshCw className="h-3 w-3" />
                  Atualizar
                </Button>
              </div>
            </div>

            {loadingReviews ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredReviews.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {reviews.length === 0
                    ? "Nenhuma solicitação registrada ainda."
                    : "Nenhuma solicitação com este filtro."}
                </p>
                {reviews.length > 0 && statusFilter !== "ALL" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStatusFilter("ALL")}
                  >
                    Limpar filtro
                  </Button>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {filteredReviews.map((r) => {
                  const meta =
                    STATUS_META[r.status] ?? { label: r.status, tone: "muted" as const };
                  const reason =
                    r.errorMessage ?? r.resolvedReason ?? r.qualificationReason;
                  return (
                    <li
                      key={r.id}
                      className="grid items-start gap-4 p-4 transition hover:bg-muted/30 md:grid-cols-[auto_1.6fr_1fr_1.2fr]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                        <StatusDot tone={meta.tone} />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <Hash className="h-3 w-3 text-muted-foreground/60" />
                          <p className="truncate font-mono text-sm">
                            {r.amazonOrderId}
                          </p>
                          <ReviewStatusBadge status={r.status} />
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.sku ?? "SKU não informado"}
                          {r.asin ? ` · ${r.asin}` : ""}
                        </p>
                      </div>
                      <dl className="grid grid-cols-1 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-[auto_1fr] sm:gap-x-2">
                        <dt className="text-muted-foreground/70">Pedido</dt>
                        <dd className="text-foreground/80">
                          {formatDateTime(r.orderCreatedAt)}
                        </dd>
                        {r.sentAt && (
                          <>
                            <dt className="text-emerald-600/80">Enviado</dt>
                            <dd className="text-emerald-700">
                              {formatDateTime(r.sentAt)}
                            </dd>
                          </>
                        )}
                        {r.nextCheckAt && !r.sentAt && (
                          <>
                            <dt className="text-muted-foreground/70">Próxima</dt>
                            <dd className="text-foreground/80">
                              {formatDateTime(r.nextCheckAt)}
                            </dd>
                          </>
                        )}
                      </dl>
                      <div className="text-xs">
                        {reason ? (
                          <p
                            className={cn(
                              r.errorMessage
                                ? "text-rose-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {reason}
                          </p>
                        ) : (
                          <p className="text-muted-foreground/70">—</p>
                        )}
                        {r.attempts > 0 && (
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
                            {r.attempts} tentativa{r.attempts > 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="produtos" className="mt-4">
          <div className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">Controle individual por SKU</h3>
                <p className="text-xs text-muted-foreground">
                  Desative um produto para excluí-lo da automação. O histórico
                  por SKU continua visível.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="success" /> {ativosCount} ativos
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone="muted" /> {pausadosCount} pausados
                </span>
              </div>
            </div>

            {loadingProdutos ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : produtos.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Nenhum produto ativo cadastrado.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {produtos.map((p) => {
                  const ultimaRel = formatRelative(p.ultimaEnvioEm);
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        "grid items-center gap-4 p-4 transition hover:bg-muted/30 md:grid-cols-[auto_1.6fr_1fr_auto]",
                        !p.solicitarReviewsAtivo && "bg-muted/20",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted",
                          !p.solicitarReviewsAtivo && "opacity-60",
                        )}
                      >
                        {p.imagemUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imagemUrl}
                            alt={p.nome}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <PackageOpen className="h-6 w-6 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p
                          className={cn(
                            "truncate text-sm font-medium",
                            !p.solicitarReviewsAtivo && "text-muted-foreground",
                          )}
                        >
                          {p.nome}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                            {p.sku}
                          </span>
                          {p.asin && (
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                              {p.asin}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="font-medium tabular-nums">
                            {p.totalEnviadas}
                          </span>
                          <span className="text-muted-foreground">enviadas</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {ultimaRel ? `Última ${ultimaRel}` : "Sem envios ainda"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                            p.solicitarReviewsAtivo
                              ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20"
                              : "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
                          )}
                        >
                          {p.solicitarReviewsAtivo ? (
                            <Circle className="h-2 w-2 fill-current" />
                          ) : (
                            <Circle className="h-2 w-2" />
                          )}
                          {p.solicitarReviewsAtivo ? "Ativo" : "Pausado"}
                        </span>
                        <Switch
                          checked={p.solicitarReviewsAtivo}
                          onCheckedChange={(v) =>
                            toggleProduto.mutate({ produtoId: p.id, ativo: v })
                          }
                          aria-label={`Ativar reviews para ${p.nome}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
