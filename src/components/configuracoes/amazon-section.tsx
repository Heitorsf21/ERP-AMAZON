"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Loader2, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJSON } from "@/lib/fetcher";

// Conexão da conta Amazon do cliente via OAuth (Login with Amazon → Seller
// Central). O formulário manual de credenciais LWA saiu da UI — o endpoint
// POST /api/amazon/config continua existindo para operação via script.
type ConfigResponse = {
  config: Record<string, string>;
  configurado: boolean;
  conta: {
    oauthConectado: boolean;
    status: string;
    sellerId: string | null;
    conectadoEm: string | null;
  } | null;
};

function formatData(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function AmazonSection() {
  const qc = useQueryClient();

  const { data: configData, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["amazon-config"],
    queryFn: () => fetchJSON<ConfigResponse>("/api/amazon/config"),
  });

  const desconectar = useMutation({
    mutationFn: () => fetchJSON("/api/amazon/oauth/desconectar", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-config"] });
      toast.success("Conta Amazon desconectada.");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao desconectar."),
  });

  const conta = configData?.conta ?? null;
  const oauthConectado = !!conta?.oauthConectado;
  // Contas antigas podem estar configuradas pelo caminho legado (sem OAuth);
  // para o cliente isso também é "conectado".
  const conectado = oauthConectado || (configData?.configurado ?? false);
  const comErro = conta?.status === "ERRO";
  const conectadoEm = formatData(conta?.conectadoEm ?? null);

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
                Conecte sua conta de vendedor para sincronizar pedidos, estoque e
                financeiro automaticamente.
              </CardDescription>
            </div>
          </div>
          {configData &&
            (comErro ? (
              <Badge variant="destructive">Erro na conexao</Badge>
            ) : (
              <Badge variant={conectado ? "success" : "secondary"}>
                {conectado ? "Conectada" : "Nao conectada"}
              </Badge>
            ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {conectado
                  ? "Sua conta esta vinculada ao Atlas Seller."
                  : "Nenhuma conta vinculada ainda."}
              </p>
              <p className="text-xs text-muted-foreground">
                {conectado
                  ? [
                      conta?.sellerId ? `Seller ${conta.sellerId}` : null,
                      conectadoEm ? `conectada em ${conectadoEm}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Sincronizacao automatica ativa."
                  : "Voce sera redirecionado ao Seller Central para autorizar o acesso."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={conectado ? "outline" : "default"}
                onClick={() => window.location.assign("/api/amazon/oauth/iniciar")}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                {conectado ? "Reconectar" : "Conectar com a Amazon"}
              </Button>
              {oauthConectado && (
                <Button
                  variant="outline"
                  onClick={() => desconectar.mutate()}
                  disabled={desconectar.isPending}
                >
                  {desconectar.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Unplug className="mr-2 h-4 w-4" />
                  )}
                  Desconectar
                </Button>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A autorizacao usa o login oficial da Amazon — suas credenciais nunca
          passam pelo Atlas Seller. Apos conectar, a primeira sincronizacao
          comeca em poucos minutos.
        </p>
      </CardContent>
    </Card>
  );
}
