"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  MessageSquare,
  PackageOpen,
  Play,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function ReviewStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    PENDENTE: "Pendente",
    AGUARDANDO: "Aguardando",
    ELEGIVEL: "Elegível",
    ENVIADO: "Enviado",
    JA_SOLICITADO: "Ja solicitado",
    NAO_ELEGIVEL: "Não elegível",
    EXPIRADO: "Expirado",
    ERRO: "Erro",
  };

  if (status === "ENVIADO") return <Badge variant="success">{labels[status]}</Badge>;
  if (status === "JA_SOLICITADO") return <Badge variant="success">{labels[status]}</Badge>;
  if (status === "ERRO") return <Badge variant="destructive">{labels[status]}</Badge>;
  if (status === "EXPIRADO") return <Badge variant="warning">{labels[status]}</Badge>;
  if (status === "AGUARDANDO") return <Badge variant="secondary">{labels[status]}</Badge>;
  if (status === "ELEGIVEL") return <Badge variant="outline">{labels[status]}</Badge>;
  return <Badge variant="secondary">{labels[status] ?? status}</Badge>;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
    success: "border-success/30 bg-success/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    danger: "border-destructive/30 bg-destructive/5",
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
  const [orderId, setOrderId] = React.useState("");

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
          ? "Automação diária ativada."
          : "Automação diária desativada.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const rodarAgora = useMutation({
    mutationFn: () =>
      fetchJSON<{
        queued?: boolean;
        executada: boolean;
        motivo?: string;
        pedidos30d: number;
        naFila: number;
        tentadosHoje: number;
        enviadosHoje: number;
        jaSolicitados: number;
        adiadosAmanha: number;
        expirados: number;
        errosReais: number;
        verificados: number;
        enviados: number;
        ignorados: number;
      }>("/api/amazon/reviews/cron-daily", { method: "POST" }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reviews-historico"] });
      qc.invalidateQueries({ queryKey: ["reviews-metricas"] });
      qc.invalidateQueries({ queryKey: ["reviews-config"] });
      if (data.queued) {
        toast.success("Automacao de avaliacoes enfileirada.");
        return;
      }
      if (!data.executada) {
        toast.info(data.motivo ?? "Automação não executou.");
        return;
      }
      toast.success(
        `${data.enviadosHoje} enviados, ${data.tentadosHoje} tentados, ${data.adiadosAmanha} adiados.`,
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const verificar = useMutation({
    mutationFn: () =>
      fetchJSON<ReviewSolicitation>("/api/amazon/reviews/check", {
        method: "POST",
        body: JSON.stringify({ amazonOrderId: orderId.trim() }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reviews-historico"] });
      qc.invalidateQueries({ queryKey: ["reviews-metricas"] });
      toast.success(
        data.status === "ELEGIVEL"
          ? "Pedido elegível para envio."
          : "Pedido verificado.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const enviar = useMutation({
    mutationFn: () =>
      fetchJSON<ReviewSolicitation>("/api/amazon/reviews/send", {
        method: "POST",
        body: JSON.stringify({ amazonOrderId: orderId.trim(), confirm: true }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["reviews-historico"] });
      qc.invalidateQueries({ queryKey: ["reviews-metricas"] });
      if (data.status === "ENVIADO") {
        toast.success("Solicitacao oficial enviada pela Amazon.");
        return;
      }
      if (data.status === "JA_SOLICITADO") {
        toast.success("Pedido ja constava como solicitado na Amazon.");
        return;
      }
      if (data.status === "AGUARDANDO") {
        toast.info("A Amazon ainda nao liberou este pedido; ele ficou na fila.");
        return;
      }
      toast.info("Pedido atualizado no historico de avaliacoes.");
      return;
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

  function confirmarEnvioManual() {
    if (!orderId.trim()) {
      toast.error("Informe o número do pedido Amazon.");
      return;
    }
    const ok = window.confirm(
      "Enviar a solicitação oficial da Amazon para este pedido? Essa ação é real e não deve ser repetida.",
    );
    if (ok) enviar.mutate();
  }

  const ultimaExecucaoHint = config?.ultimaExecucao
    ? `última execução ${formatDistanceToNow(new Date(config.ultimaExecucao), {
        locale: ptBR,
        addSuffix: true,
      })}`
    : "nunca executada";

  const pausadosCount = produtos.filter((p) => !p.solicitarReviewsAtivo).length;

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
        description="Automação diária de pedidos de review no Amazon Seller Central via SP-API."
      >
        <Badge variant={config?.automacaoAtiva ? "success" : "secondary"}>
          {config?.automacaoAtiva ? "Automação ativa" : "Automação desativada"}
        </Badge>
      </PageHeader>

      {/* Card automação */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">Automação diária</h3>
              <Switch
                checked={config?.automacaoAtiva ?? false}
                disabled={loadingConfig || toggleAutomacao.isPending}
                onCheckedChange={(v) => toggleAutomacao.mutate(v)}
                aria-label="Ativar automação diária"
              />
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              Quando ativa, o sistema busca pedidos criados nos ultimos 30 dias,
              tenta a solicitacao oficial e deixa na fila para o dia seguinte
              quando a Amazon ainda nao liberar o envio.
            </p>
            <p className="text-xs text-muted-foreground">
              <Clock className="mr-1 inline h-3 w-3" />
              {ultimaExecucaoHint}
              {pausadosCount > 0 && ` · ${pausadosCount} SKU(s) pausado(s)`}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => rodarAgora.mutate()}
            disabled={rodarAgora.isPending}
          >
            {rodarAgora.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Rodar agora
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pedidos 30d"
          value={metricas?.pedidos30d ?? "-"}
          hint={metricas ? `${metricas.naFila} na fila` : undefined}
          icon={CheckCircle2}
          tone="default"
        />
        <KpiCard
          label="Enviadas hoje"
          value={metricas?.enviadosHoje ?? metricas?.enviadasHoje ?? "-"}
          hint={metricas ? `${metricas.tentadosHoje} tentados hoje` : undefined}
          icon={Send}
          tone="success"
        />
        <KpiCard
          label="Adiados"
          value={metricas?.adiadosAmanha ?? "-"}
          hint={metricas ? `${metricas.jaSolicitados} ja solicitados` : undefined}
          icon={MessageSquare}
        />
        <KpiCard
          label="Erros"
          value={metricas?.errosReais ?? "-"}
          hint={metricas ? `${metricas.expirados} expirados` : undefined}
          icon={TriangleAlert}
          tone={metricas && metricas.errosReais > 0 ? "danger" : "default"}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="historico">
        <TabsList>
          <TabsTrigger value="historico">Geral & Histórico</TabsTrigger>
          <TabsTrigger value="produtos">Por Produto</TabsTrigger>
        </TabsList>

        <TabsContent value="historico" className="mt-4 space-y-4">
          <div className="rounded-xl border bg-card p-5">
            <h3 className="mb-1 text-sm font-semibold">Envio manual</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Use para testar um pedido específico. A automação diária já cobre os
              elegíveis automaticamente.
            </p>
            <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_auto_auto]">
              <Input
                placeholder="Ex: 702-1234567-1234567"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => verificar.mutate()}
                disabled={verificar.isPending || !orderId.trim()}
              >
                {verificar.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Verificar
              </Button>
              <Button
                onClick={confirmarEnvioManual}
                disabled={enviar.isPending || !orderId.trim()}
              >
                {enviar.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Enviar
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="text-sm font-semibold">Histórico de solicitações</h3>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Exportar CSV"
                  disabled={!reviews.length}
                  onClick={() => exportarReviewsCSV(reviews)}
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
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : reviews.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma solicitação registrada ainda.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    className="grid gap-3 p-4 md:grid-cols-[1.4fr_.8fr_1fr_1fr] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{r.amazonOrderId}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.sku ?? "SKU não informado"}
                        {r.asin ? ` · ${r.asin}` : ""}
                      </p>
                    </div>
                    <ReviewStatusBadge status={r.status} />
                    <div className="text-xs text-muted-foreground">
                      <p>Pedido: {formatDateTime(r.orderCreatedAt)}</p>
                      <p>Checado: {formatDateTime(r.checkedAt)}</p>
                      <p>Enviado: {formatDateTime(r.sentAt)}</p>
                      <p>Proxima: {formatDateTime(r.nextCheckAt)}</p>
                    </div>
                    {r.errorMessage ? (
                      <p className="text-xs text-destructive">{r.errorMessage}</p>
                    ) : r.qualificationReason || r.resolvedReason ? (
                      <p className="text-xs text-muted-foreground">
                        {r.resolvedReason ?? r.qualificationReason}
                        {r.attempts > 0 ? ` · ${r.attempts} tentativa(s)` : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="produtos" className="mt-4">
          <div className="rounded-xl border bg-card">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Controle individual por SKU</h3>
              <p className="text-sm text-muted-foreground">
                Desative um produto para excluí-lo da automação diária. O histórico
                por SKU continua visível.
              </p>
            </div>

            {loadingProdutos ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : produtos.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <PackageOpen className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Nenhum produto ativo cadastrado.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {produtos.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 p-4"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {p.imagemUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imagemUrl}
                          alt={p.nome}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <PackageOpen className="h-5 w-5 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.sku}
                        {p.asin ? ` · ${p.asin}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.totalEnviadas} enviadas
                        {p.ultimaEnvioEm
                          ? ` · última ${formatDistanceToNow(
                              new Date(p.ultimaEnvioEm),
                              { locale: ptBR, addSuffix: true },
                            )}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          p.solicitarReviewsAtivo
                            ? "text-success"
                            : "text-muted-foreground",
                        )}
                      >
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
