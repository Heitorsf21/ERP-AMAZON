"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Mail,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type StatusResponse = {
  credenciaisConfiguradas: boolean;
  autorizado: boolean;
  conectado: boolean;
  emailConta: string | null;
  ultimaSincronizacao: string | null;
  clientIdMasked: string | null;
  historico: SyncHistorico[];
};

type SyncHistorico = {
  data: string;
  emailsEncontrados: number;
  resultados: SyncResultado[];
  erros: string[];
};

type SyncResultado = {
  arquivo: string;
  tipo: string;
  registros: number;
  mensagem: string | null;
  remetente: string;
};

const TIPO_LABELS: Record<string, string> = {
  AMAZON_CSV: "Amazon CSV",
  NUBANK_CSV: "Nubank CSV",
  NUBANK_OFX: "Nubank OFX",
  IGNORADO: "Ignorado",
  ERRO: "Erro",
};

export function GmailSection() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [showSetup, setShowSetup] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [diasAtras, setDiasAtras] = React.useState(14);

  // Handle OAuth callback result via URL params
  React.useEffect(() => {
    const ok = searchParams.get("gmail_ok");
    const erro = searchParams.get("gmail_erro");
    if (ok) {
      toast.success("Gmail conectado com sucesso!");
      qc.invalidateQueries({ queryKey: ["email-status"] });
      // Clean URL
      window.history.replaceState({}, "", "/configuracoes");
    }
    if (erro) {
      toast.error(`Erro ao conectar Gmail: ${decodeURIComponent(erro)}`);
      window.history.replaceState({}, "", "/configuracoes");
    }
  }, [searchParams, qc]);

  const { data: status, isLoading } = useQuery<StatusResponse>({
    queryKey: ["email-status"],
    queryFn: () => fetchJSON<StatusResponse>("/api/email/status"),
    retry: false,
  });

  const salvarConfig = useMutation({
    mutationFn: (creds: { clientId: string; clientSecret: string }) =>
      fetchJSON("/api/email/config", {
        method: "POST",
        body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-status"] });
      toast.success("Credenciais salvas.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const sincronizar = useMutation({
    mutationFn: () =>
      fetchJSON<{ ok: boolean; emailsEncontrados: number; resultados: SyncResultado[]; erros: string[] }>(
        "/api/email/sincronizar",
        { method: "POST", body: JSON.stringify({ diasAtras }) },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["email-status"] });
      const total = data.resultados.filter((r) => r.tipo !== "IGNORADO").length;
      if (total > 0) {
        toast.success(`${total} arquivo(s) importado(s) com sucesso.`);
      } else if (data.emailsEncontrados === 0) {
        toast.info("Nenhum email novo com anexos encontrado.");
      } else {
        toast.info("Emails verificados — nenhum arquivo reconhecido para importar.");
      }
      if (data.erros.length) {
        toast.error(`${data.erros.length} erro(s): ${data.erros[0]}`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro na sincronização"),
  });

  async function conectarGmail() {
    try {
      const res = await fetchJSON<{ url: string }>("/api/email/auth-url");
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar URL de autorização");
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-9 w-36" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              status?.conectado
                ? "bg-success/15 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Importação via Gmail</h3>
              {status?.conectado ? (
                <Badge variant="success" className="text-[10px]">Conectado</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">Desconectado</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status?.conectado
                ? `Conta: ${status.emailConta ?? "—"}`
                : "Conecte seu Gmail para importar extratos Nubank e relatórios Amazon automaticamente."}
            </p>
            {status?.ultimaSincronizacao && (
              <p className="mt-1 text-xs text-muted-foreground/60">
                Última sync:{" "}
                {formatDistanceToNow(new Date(status.ultimaSincronizacao), {
                  locale: ptBR,
                  addSuffix: true,
                })}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {status?.conectado && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Label className="whitespace-nowrap text-xs">Últimos</Label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={diasAtras}
                  onChange={(e) => setDiasAtras(Number(e.target.value))}
                  className="h-8 w-14 text-xs"
                />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
              <Button
                size="sm"
                onClick={() => sincronizar.mutate()}
                disabled={sincronizar.isPending}
              >
                {sincronizar.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                {sincronizar.isPending ? "Verificando…" : "Sincronizar"}
              </Button>
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSetup((v) => !v)}
            className="text-muted-foreground"
          >
            {showSetup ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Configurar
          </Button>
        </div>
      </div>

      {/* Setup panel */}
      {showSetup && (
        <div className="border-t p-5 space-y-5">
          {/* Instructions */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
            <p className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
              <Info className="h-4 w-4 text-primary" />
              Como configurar (1 vez)
            </p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs leading-relaxed">
              <li>
                Acesse{" "}
                <a
                  href="https://console.cloud.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Google Cloud Console <ExternalLink className="h-3 w-3" />
                </a>{" "}
                → crie um projeto ou use um existente
              </li>
              <li>Ative a <strong>Gmail API</strong> em &ldquo;APIs e Serviços&rdquo;</li>
              <li>
                Crie credenciais OAuth2 (tipo: <strong>Aplicativo da Web</strong>) e adicione{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  http://localhost:3000/api/email/callback
                </code>{" "}
                como URI de redirecionamento autorizado
              </li>
              <li>Copie o <strong>Client ID</strong> e <strong>Client Secret</strong> abaixo</li>
              <li>Clique em <strong>Salvar</strong> e depois em <strong>Autorizar Gmail</strong></li>
            </ol>
          </div>

          {/* Credentials form */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Client ID</Label>
              <Input
                placeholder={status?.clientIdMasked ?? "...Client ID"}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Client Secret</Label>
              <Input
                type="password"
                placeholder="Client Secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => salvarConfig.mutate({ clientId, clientSecret })}
              disabled={salvarConfig.isPending || !clientId || !clientSecret}
            >
              {salvarConfig.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar credenciais
            </Button>
            <Button
              size="sm"
              onClick={conectarGmail}
              disabled={!status?.credenciaisConfiguradas}
            >
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Autorizar Gmail
            </Button>
            {status?.conectado && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                Desconectar
              </Button>
            )}
          </div>

          {/* What gets imported */}
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground/80">O que é importado automaticamente:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li><strong>Amazon CSV</strong> — relatórios Unified Transaction → Contas a Receber</li>
              <li><strong>Nubank CSV/OFX</strong> — extratos bancários → Caixa / Movimentações</li>
            </ul>
            <p className="mt-1 text-muted-foreground/60">
              PDFs (boletos, NF-e) devem ser enviados manualmente em Documentos Financeiros.
            </p>
          </div>
        </div>
      )}

      {/* Sync history */}
      {status?.conectado && status.historico.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-success" />
              Histórico de sincronizações ({status.historico.length})
            </span>
            {showHistory ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          {showHistory && (
            <div className="border-t divide-y">
              {[...status.historico].reverse().map((entry, i) => (
                <div key={i} className="px-5 py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {new Date(entry.data).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {entry.emailsEncontrados} email(s)
                    </span>
                  </div>
                  {entry.resultados.filter((r) => r.tipo !== "IGNORADO").map((r, j) => (
                    <div key={j} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle className="h-3 w-3 text-success shrink-0" />
                      <span className="font-mono truncate max-w-[200px]">{r.arquivo}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {TIPO_LABELS[r.tipo] ?? r.tipo}
                      </Badge>
                      <span>{r.registros} reg.</span>
                    </div>
                  ))}
                  {entry.erros.map((e, j) => (
                    <div key={j} className="flex items-start gap-2 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>{e}</span>
                    </div>
                  ))}
                  {entry.resultados.every((r) => r.tipo === "IGNORADO") && entry.erros.length === 0 && (
                    <p className="text-xs text-muted-foreground/60">Nenhum arquivo reconhecido.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
