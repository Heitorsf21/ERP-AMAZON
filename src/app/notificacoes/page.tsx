"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellOff,
  CheckCheck,
  Package,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  Zap,
  Clock,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchJSON } from "@/lib/fetcher";

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  lida: boolean;
  linkRef: string | null;
  criadaEm: string;
};

const TIPO_CONFIG: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  ESTOQUE_CRITICO: { label: "Estoque Crítico", icon: Package, color: "text-red-500" },
  BUYBOX_PERDIDO: { label: "Buybox Perdida", icon: TrendingDown, color: "text-orange-500" },
  REEMBOLSO_ALTO: { label: "Reembolso Alto", icon: ShoppingBag, color: "text-yellow-600" },
  ACOS_ALTO: { label: "ACoS Elevado", icon: Zap, color: "text-purple-500" },
  LIQUIDACAO_ATRASADA: { label: "Liquidação Atrasada", icon: Clock, color: "text-blue-500" },
  CUSTO_AUSENTE: { label: "Custo Ausente", icon: DollarSign, color: "text-gray-500" },
};

function formatarData(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificacoesPage() {
  const queryClient = useQueryClient();

  const { data: notificacoes, isLoading } = useQuery<Notificacao[]>({
    queryKey: ["notificacoes"],
    queryFn: () => fetchJSON("/api/notificacoes"),
  });

  const gerarMut = useMutation({
    mutationFn: () =>
      fetchJSON("/api/notificacoes", { method: "POST" }) as Promise<{
        criadas: number;
        verificadas: number;
      }>,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes-count"] });
      toast.success(`${res.criadas} nova${res.criadas !== 1 ? "s" : ""} notificação${res.criadas !== 1 ? "ões" : ""} gerada${res.criadas !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Erro ao gerar notificações"),
  });

  const marcarLidaMut = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/notificacoes/${id}`, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes-count"] });
    },
  });

  const marcarTodasMut = useMutation({
    mutationFn: () =>
      fetchJSON("/api/notificacoes/marcar-todas-lidas", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes-count"] });
      toast.success("Todas marcadas como lidas");
    },
  });

  const naoLidas = notificacoes?.filter((n) => !n.lida).length ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Notificações"
        description="Alertas automáticos gerados pelo ERP"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => gerarMut.mutate()}
            disabled={gerarMut.isPending}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", gerarMut.isPending && "animate-spin")} />
            Verificar agora
          </Button>
          {naoLidas > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => marcarTodasMut.mutate()}
              disabled={marcarTodasMut.isPending}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Marcar todas como lidas
            </Button>
          )}
        </div>
      </PageHeader>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : !notificacoes || notificacoes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <BellOff className="h-10 w-10 opacity-40" />
            <p className="text-sm">Nenhuma notificação ainda</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => gerarMut.mutate()}
              disabled={gerarMut.isPending}
            >
              Verificar alertas agora
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {notificacoes.map((n) => {
            const config = TIPO_CONFIG[n.tipo] ?? {
              label: n.tipo,
              icon: AlertTriangle,
              color: "text-muted-foreground",
            };
            const Icon = config.icon;

            return (
              <Card
                key={n.id}
                className={cn(
                  "transition-opacity",
                  n.lida && "opacity-60",
                )}
              >
                <CardContent className="flex items-start gap-4 py-4">
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted",
                      config.color,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className={cn("text-sm font-medium", !n.lida && "font-semibold")}>
                          {n.titulo}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{n.descricao}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {config.label}
                        </Badge>
                        {!n.lida && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => marcarLidaMut.mutate(n.id)}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatarData(n.criadaEm)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
