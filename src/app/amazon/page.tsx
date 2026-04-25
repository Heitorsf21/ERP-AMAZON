"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
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

type QueueSummary = {
  queued: number;
  running: number;
  failed: number;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "SUCESSO") return <Badge variant="success">Sucesso</Badge>;
  if (status === "ERRO") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">Processando</Badge>;
}

function TipoBadge({ tipo }: { tipo: string }) {
  const map: Record<string, string> = {
    ORDERS: "Pedidos",
    INVENTORY: "Inventario",
    REVIEWS: "Avaliacoes",
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
      Ultima sync: {ago}
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
  const [diasAtras, setDiasAtras] = React.useState(30);

  const { data: configData } = useQuery<ConfigResponse>({
    queryKey: ["amazon-config"],
    queryFn: () => fetchJSON<ConfigResponse>("/api/amazon/config"),
  });

  const { data: logs = [], isLoading: loadingLogs } = useQuery<SyncLog[]>({
    queryKey: ["amazon-logs"],
    queryFn: () => fetchJSON<SyncLog[]>("/api/amazon/status"),
    refetchInterval: 8_000,
  });

  const { data: queue } = useQuery<QueueSummary>({
    queryKey: ["amazon-jobs"],
    queryFn: () => fetchJSON<QueueSummary>("/api/amazon/jobs"),
    refetchInterval: 8_000,
  });

  const sincronizarPedidos = useMutation({
    mutationFn: () =>
      fetchJSON("/api/amazon/sync", {
        method: "POST",
        body: JSON.stringify({ tipo: "ORDERS", diasAtras }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
      qc.invalidateQueries({ queryKey: ["amazon-jobs"] });
      toast.success("Sincronizacao de pedidos enfileirada.");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Erro na sincronizacao"),
  });

  const sincronizarInventario = useMutation({
    mutationFn: () =>
      fetchJSON("/api/amazon/sync", {
        method: "POST",
        body: JSON.stringify({ tipo: "INVENTORY", diasAtras }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-logs"] });
      toast.success("Inventario verificado.");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Erro ao verificar inventario"),
  });

  const qualquerSyncAtivo =
    sincronizarPedidos.isPending || sincronizarInventario.isPending;

  const configurado = configData?.configurado ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conector Amazon"
        description="Painel operacional. Para editar credenciais, va para Configuracoes > Integracoes."
      >
        <div className="flex flex-wrap items-center gap-2">
          {configData && (
            <Badge variant={configurado ? "success" : "secondary"}>
              {configurado ? "Configurado" : "Nao configurado"}
            </Badge>
          )}
          {queue && (
            <Badge variant="outline">
              Fila: {queue.queued} pend. / {queue.running} rodando
            </Badge>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/sistema" className="inline-flex items-center gap-1">
              Ver saude do sistema
              <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </PageHeader>

      {!configurado && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">Credenciais nao configuradas</p>
              <p className="text-xs text-muted-foreground">
                Configure as credenciais SP-API para habilitar sincronizacoes.
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link href="/configuracoes" className="inline-flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              Configurar
            </Link>
          </Button>
        </div>
      )}

      <Tabs defaultValue="sync">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="sync" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Sincronizacao manual
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            <Activity className="h-4 w-4" />
            Historico
            {logs.some((l) => l.status === "ERRO") && (
              <span className="ml-1 flex h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="mt-4">
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold">Ler Pedidos (Orders API)</h3>
                {!loadingLogs && <LastSync logs={logs} tipo="ORDERS" />}
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Busca pedidos recentes pela Orders API 2026-01-01 e registra o resultado no historico.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Label className="whitespace-nowrap">Ultimos</Label>
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
                  disabled={qualquerSyncAtivo || !configurado}
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
                      ? "Concluido"
                      : sincronizarPedidos.isError
                        ? "Tentar novamente"
                        : "Ler Pedidos"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold">Verificar Inventario FBA</h3>
                {!loadingLogs && <LastSync logs={logs} tipo="INVENTORY" />}
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                Compara o inventario FBA da Amazon com o estoque no ERP e lista divergencias.
              </p>
              <Button
                variant={sincronizarInventario.isError ? "destructive" : "outline"}
                onClick={() => sincronizarInventario.mutate()}
                disabled={qualquerSyncAtivo || !configurado}
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
                      : "Verificar Inventario"}
              </Button>
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
              <p className="text-sm text-muted-foreground">Nenhuma sincronizacao realizada.</p>
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
