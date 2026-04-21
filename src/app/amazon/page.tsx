"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type ConfigResponse = {
  config: Record<string, string>;
  configurado: boolean;
};

type SyncLog = {
  id: string;
  tipo: string;
  status: string;
  mensagem: string | null;
  registros: number;
  createdAt: string;
};

type ReviewSolicitation = {
  id: string;
  amazonOrderId: string;
  marketplaceId: string;
  status: string;
  asin: string | null;
  sku: string | null;
  checkedAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

const CAMPOS_CONFIG = [
  {
    key: "amazon_client_id",
    label: "LWA Client ID",
    placeholder: "amzn1.application-oa2-client...",
    secret: false,
  },
  {
    key: "amazon_client_secret",
    label: "LWA Client Secret",
    placeholder: "...",
    secret: true,
  },
  {
    key: "amazon_refresh_token",
    label: "LWA Refresh Token",
    placeholder: "Atz|...",
    secret: true,
  },
  {
    key: "amazon_marketplace_id",
    label: "Marketplace ID",
    placeholder: "A2Q3Y263D00KWC",
    secret: false,
  },
  {
    key: "amazon_endpoint",
    label: "SP-API Endpoint",
    placeholder: "https://sellingpartnerapi-na.amazon.com",
    secret: false,
  },
] as const;

function StatusBadge({ status }: { status: string }) {
  if (status === "SUCESSO") return <Badge variant="success">Sucesso</Badge>;
  if (status === "ERRO") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">Processando</Badge>;
}

function ReviewStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    PENDENTE: "Pendente",
    ELEGIVEL: "Elegível",
    ENVIADO: "Enviado",
    NAO_ELEGIVEL: "Não elegível",
    ERRO: "Erro",
  };

  if (status === "ENVIADO") return <Badge variant="success">{labels[status]}</Badge>;
  if (status === "ERRO") return <Badge variant="destructive">{labels[status]}</Badge>;
  if (status === "ELEGIVEL") return <Badge variant="outline">{labels[status]}</Badge>;
  return <Badge variant="secondary">{labels[status] ?? status}</Badge>;
}

function TipoBadge({ tipo }: { tipo: string }) {
  const map: Record<string, string> = {
    ORDERS: "Pedidos",
    INVENTORY: "Inventário",
    REVIEWS: "Avaliações",
    ALL: "Completo",
    TEST: "Teste",
  };
  return <Badge variant="outline">{map[tipo] ?? tipo}</Badge>;
}

function LastSync({ logs, tipo }: { logs: SyncLog[]; tipo: string }) {
  const last = logs.find((l) => l.tipo === tipo && l.status === "SUCESSO");
  if (!last) return null;

  const ago = formatDistanceToNow(new Date(last.createdAt), {
    locale: ptBR,
    addSuffix: true,
  });

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3 w-3 shrink-0" />
      Última sync: {ago}
      {last.registros > 0 && (
        <span className="ml-1 text-muted-foreground/60">- {last.registros} reg.</span>
      )}
    </span>
  );
}

function formatDate(value: string | null) {
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

export default function AmazonPage() {
  const qc = useQueryClient();
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});
  const [camposVisiveis, setCamposVisiveis] = React.useState<Set<string>>(new Set());
  const [diasAtras, setDiasAtras] = React.useState(30);
  const [reviewOrderId, setReviewOrderId] = React.useState("");

  const { data: configData, isLoading: loadingConfig } = useQuery<ConfigResponse>({
    queryKey: ["amazon-config"],
    queryFn: () => fetchJSON<ConfigResponse>("/api/amazon/config"),
  });

  const { data: logs = [], isLoading: loadingLogs } = useQuery<SyncLog[]>({
    queryKey: ["amazon-logs"],
    queryFn: () => fetchJSON<SyncLog[]>("/api/amazon/status"),
    refetchInterval: 8_000,
  });

  const { data: reviews = [], isLoading: loadingReviews } = useQuery<
    ReviewSolicitation[]
  >({
    queryKey: ["amazon-reviews"],
    queryFn: () => fetchJSON<ReviewSolicitation[]>("/api/amazon/reviews"),
    refetchInterval: 10_000,
  });

  React.useEffect(() => {
    if (!configData) return;

    setFormValues({
      amazon_marketplace_id: "A2Q3Y263D00KWC",
      amazon_endpoint: "https://sellingpartnerapi-na.amazon.com",
      ...configData.config,
    });
  }, [configData]);

  const salvarConfig = useMutation({
    mutationFn: (values: Record<string, string>) =>
      fetchJSON("/api/amazon/config", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-config"] });
      toast.success("Configurações salvas.");
    },
    onError: () => toast.error("Erro ao salvar configurações."),
  });

  const testarConexao = useMutation({
    mutationFn: () =>
      fetchJSON<{ ok: boolean; mensagem: string }>("/api/amazon/sync", {
        method: "POST",
        body: JSON.stringify({ tipo: "TEST" }),
      }),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.mensagem);
      else toast.error(data.mensagem);
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const sincronizarPedidos = useMutation({
    mutationFn: () =>
      fetchJSON("/api/amazon/sync", {
        method: "POST",
        body: JSON.stringify({ tipo: "ORDERS", diasAtras }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
      toast.success("Pedidos lidos pela SP-API.");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Erro na sincronização"),
  });

  const sincronizarInventario = useMutation({
    mutationFn: () =>
      fetchJSON("/api/amazon/sync", {
        method: "POST",
        body: JSON.stringify({ tipo: "INVENTORY", diasAtras }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
      toast.success("Inventário verificado.");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Erro ao verificar inventário"),
  });

  const verificarReview = useMutation({
    mutationFn: () =>
      fetchJSON<ReviewSolicitation>("/api/amazon/reviews/check", {
        method: "POST",
        body: JSON.stringify({ amazonOrderId: reviewOrderId.trim() }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["amazon-reviews"] });
      toast.success(
        data.status === "ELEGIVEL"
          ? "Pedido elegível para solicitação oficial."
          : "Pedido verificado.",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao verificar"),
  });

  const enviarReview = useMutation({
    mutationFn: () =>
      fetchJSON<ReviewSolicitation>("/api/amazon/reviews/send", {
        method: "POST",
        body: JSON.stringify({ amazonOrderId: reviewOrderId.trim(), confirm: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-reviews"] });
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
      toast.success("Solicitação oficial enviada pela Amazon.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao enviar"),
  });

  const processarReviews = useMutation({
    mutationFn: () =>
      fetchJSON<{ verificados: number; enviados: number; ignorados: number }>(
        "/api/amazon/reviews/auto",
        {
          method: "POST",
          body: JSON.stringify({ diasAtras }),
        },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["amazon-reviews"] });
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
      toast.success(
        `${data.enviados} enviados, ${data.verificados} verificados, ${data.ignorados} ignorados.`,
      );
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Erro no processamento"),
  });

  function toggleVisivel(key: string) {
    setCamposVisiveis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function confirmarEnvioManual() {
    if (!reviewOrderId.trim()) {
      toast.error("Informe o número do pedido Amazon.");
      return;
    }

    const ok = window.confirm(
      "Enviar a solicitação oficial da Amazon para este pedido? Essa ação é real e não deve ser repetida.",
    );
    if (ok) enviarReview.mutate();
  }

  const qualquerSyncAtivo =
    sincronizarPedidos.isPending ||
    sincronizarInventario.isPending ||
    testarConexao.isPending ||
    verificarReview.isPending ||
    enviarReview.isPending ||
    processarReviews.isPending;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Conector Amazon"
        description="Integração com Amazon SP-API para sincronizar pedidos, inventário e solicitações oficiais de avaliação."
      >
        <div className="flex items-center gap-2">
          {configData && (
            <Badge variant={configData.configurado ? "success" : "secondary"}>
              {configData.configurado ? "Configurado" : "Não configurado"}
            </Badge>
          )}
        </div>
      </PageHeader>

      <Tabs defaultValue="config">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="config" className="gap-2">
            <Settings className="h-4 w-4" />
            Credenciais
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Sincronização
          </TabsTrigger>
          <TabsTrigger value="reviews" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Avaliações
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <Activity className="h-4 w-4" />
            Histórico
            {logs.some((l) => l.status === "ERRO") && (
              <span className="ml-1 flex h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Como obter as credenciais</p>
              <ol className="list-inside list-decimal space-y-1">
                <li>Acesse o Seller Central e abra o aplicativo SP-API privado.</li>
                <li>Copie o Client ID e Client Secret em Credenciais do LWA.</li>
                <li>Em Gerenciar autorizações, gere o Refresh Token do Brasil.</li>
                <li>Use o marketplace do Brasil: <code>A2Q3Y263D00KWC</code>.</li>
                <li>Use o endpoint: <code>https://sellingpartnerapi-na.amazon.com</code>.</li>
              </ol>
            </div>

            {loadingConfig ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {CAMPOS_CONFIG.map((campo) => (
                  <div key={campo.key} className="space-y-1">
                    <Label>{campo.label}</Label>
                    <div className="relative">
                      <Input
                        type={
                          campo.secret && !camposVisiveis.has(campo.key)
                            ? "password"
                            : "text"
                        }
                        placeholder={campo.placeholder}
                        value={formValues[campo.key] ?? ""}
                        onChange={(e) =>
                          setFormValues((prev) => ({
                            ...prev,
                            [campo.key]: e.target.value,
                          }))
                        }
                      />
                      {campo.secret && (
                        <button
                          type="button"
                          onClick={() => toggleVisivel(campo.key)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={
                            camposVisiveis.has(campo.key)
                              ? "Ocultar credencial"
                              : "Mostrar credencial"
                          }
                        >
                          {camposVisiveis.has(campo.key) ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                onClick={() => salvarConfig.mutate(formValues)}
                disabled={salvarConfig.isPending || loadingConfig}
              >
                {salvarConfig.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Salvar Credenciais
              </Button>
              <Button
                variant="outline"
                onClick={() => testarConexao.mutate()}
                disabled={qualquerSyncAtivo}
              >
                {testarConexao.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="mr-2 h-4 w-4" />
                )}
                Testar Conexão
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold">Ler Pedidos (Orders API)</h3>
                {!loadingLogs && <LastSync logs={logs} tipo="ORDERS" />}
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Busca pedidos recentes pela Orders API 2026-01-01 e registra o resultado no histórico.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="whitespace-nowrap">Últimos</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={diasAtras}
                    onChange={(e) => setDiasAtras(Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
                <Button
                  onClick={() => sincronizarPedidos.mutate()}
                  disabled={qualquerSyncAtivo}
                  className={cn(
                    sincronizarPedidos.isSuccess &&
                      "border-success/40 bg-success/10 text-success hover:bg-success/15",
                  )}
                  variant={sincronizarPedidos.isError ? "destructive" : "default"}
                >
                  {sincronizarPedidos.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : sincronizarPedidos.isSuccess ? (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  ) : sincronizarPedidos.isError ? (
                    <XCircle className="mr-2 h-4 w-4" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {sincronizarPedidos.isPending
                    ? "Lendo..."
                    : sincronizarPedidos.isSuccess
                      ? "Concluído"
                      : sincronizarPedidos.isError
                        ? "Tentar novamente"
                        : "Ler Pedidos"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold">Verificar Inventário FBA</h3>
                {!loadingLogs && <LastSync logs={logs} tipo="INVENTORY" />}
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Compara o inventário FBA da Amazon com o estoque no ERP e lista divergências.
              </p>
              <Button
                variant={sincronizarInventario.isError ? "destructive" : "outline"}
                onClick={() => sincronizarInventario.mutate()}
                disabled={qualquerSyncAtivo}
              >
                {sincronizarInventario.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : sincronizarInventario.isSuccess ? (
                  <CheckCircle className="mr-2 h-4 w-4 text-success" />
                ) : sincronizarInventario.isError ? (
                  <XCircle className="mr-2 h-4 w-4" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {sincronizarInventario.isPending
                  ? "Verificando..."
                  : sincronizarInventario.isSuccess
                    ? "Verificado"
                    : sincronizarInventario.isError
                      ? "Tentar novamente"
                      : "Verificar Inventário"}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reviews" className="mt-4">
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold">Solicitação oficial Amazon</h3>
                {!loadingLogs && <LastSync logs={logs} tipo="REVIEWS" />}
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Verifica elegibilidade e envia o modelo oficial da Amazon para review do produto e feedback do vendedor.
              </p>

              <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_auto_auto]">
                <Input
                  placeholder="Ex: 702-1234567-1234567"
                  value={reviewOrderId}
                  onChange={(e) => setReviewOrderId(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => verificarReview.mutate()}
                  disabled={qualquerSyncAtivo || !reviewOrderId.trim()}
                >
                  {verificarReview.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Verificar
                </Button>
                <Button
                  onClick={confirmarEnvioManual}
                  disabled={qualquerSyncAtivo || !reviewOrderId.trim()}
                >
                  {enviarReview.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Enviar
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <h3 className="mb-1 text-sm font-semibold">Processamento em lote</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Processa até 20 pedidos recentes por vez, respeitando o limite conservador de uma chamada por segundo.
              </p>
              <Button
                variant="outline"
                onClick={() => processarReviews.mutate()}
                disabled={qualquerSyncAtivo}
              >
                {processarReviews.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Processar pedidos elegíveis
              </Button>
            </div>

            <div className="rounded-xl border bg-card">
              <div className="border-b p-4">
                <h3 className="text-sm font-semibold">Histórico de solicitações</h3>
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
                    Nenhuma solicitação verificada ainda.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {reviews.map((review) => (
                    <div
                      key={review.id}
                      className="grid gap-3 p-4 md:grid-cols-[1.3fr_.8fr_.8fr_.8fr] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm">{review.amazonOrderId}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {review.sku ?? "SKU não informado"}
                          {review.asin ? ` - ${review.asin}` : ""}
                        </p>
                      </div>
                      <ReviewStatusBadge status={review.status} />
                      <div className="text-xs text-muted-foreground">
                        <p>Checado: {formatDate(review.checkedAt)}</p>
                        <p>Enviado: {formatDate(review.sentAt)}</p>
                      </div>
                      {review.errorMessage ? (
                        <p className="text-xs text-destructive">{review.errorMessage}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Sem erro registrado.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          {loadingLogs ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 py-16 text-center">
              <Activity className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhuma sincronização realizada.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border bg-card p-4",
                    log.status === "ERRO" && "border-destructive/30 bg-destructive/5",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <TipoBadge tipo={log.tipo} />
                      <StatusBadge status={log.status} />
                      {log.status === "SUCESSO" ? (
                        <CheckCircle className="h-4 w-4 text-success" />
                      ) : log.status === "ERRO" ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : null}
                    </div>
                    {log.mensagem && (
                      <p className="text-sm text-muted-foreground">{log.mensagem}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</p>
                    {log.registros > 0 && (
                      <p className="text-xs text-muted-foreground">{log.registros} registros</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
