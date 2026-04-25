"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  Globe,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJSON } from "@/lib/fetcher";

type ConfigResponse = {
  config: Record<string, string>;
  configurado: boolean;
};

type QueueSummary = {
  queued: number;
  running: number;
  failed: number;
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

export function AmazonSection() {
  const qc = useQueryClient();
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});
  const [camposVisiveis, setCamposVisiveis] = React.useState<Set<string>>(new Set());

  const { data: configData, isLoading: loadingConfig } = useQuery<ConfigResponse>({
    queryKey: ["amazon-config"],
    queryFn: () => fetchJSON<ConfigResponse>("/api/amazon/config"),
  });

  const { data: queue } = useQuery<QueueSummary>({
    queryKey: ["amazon-jobs"],
    queryFn: () => fetchJSON<QueueSummary>("/api/amazon/jobs"),
    refetchInterval: 8_000,
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
      toast.success("Credenciais salvas.");
    },
    onError: () => toast.error("Erro ao salvar credenciais."),
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

  function toggleVisivel(key: string) {
    setCamposVisiveis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Amazon Seller Central</CardTitle>
              <CardDescription>
                Credenciais SP-API usadas pelo conector e workers de sincronizacao.
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {configData && (
              <Badge variant={configData.configurado ? "success" : "secondary"}>
                {configData.configurado ? "Configurado" : "Nao configurado"}
              </Badge>
            )}
            {queue && (
              <Badge variant="outline">
                Fila: {queue.queued} pend. / {queue.running} rod.
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Como obter as credenciais
          </p>
          <ol className="list-inside list-decimal space-y-1 leading-relaxed">
            <li>Seller Central, abra o aplicativo SP-API privado.</li>
            <li>Copie o Client ID e Client Secret em Credenciais do LWA.</li>
            <li>Em Gerenciar autorizacoes, gere o Refresh Token do Brasil.</li>
            <li>Marketplace BR: <code className="rounded bg-muted px-1 font-mono">A2Q3Y263D00KWC</code></li>
            <li>Endpoint: <code className="rounded bg-muted px-1 font-mono">https://sellingpartnerapi-na.amazon.com</code></li>
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

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => salvarConfig.mutate(formValues)}
            disabled={salvarConfig.isPending || loadingConfig}
          >
            {salvarConfig.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Salvar credenciais
          </Button>
          <Button
            variant="outline"
            onClick={() => testarConexao.mutate()}
            disabled={testarConexao.isPending || loadingConfig}
          >
            {testarConexao.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Globe className="mr-2 h-4 w-4" />
            )}
            Testar conexao
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
