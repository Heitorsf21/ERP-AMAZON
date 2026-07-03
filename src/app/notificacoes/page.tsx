"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BellOff, Check, CheckCheck, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchJSON } from "@/lib/fetcher";
import { getTipoNotificacaoVisual } from "@/components/notificacoes/tipo-notificacao-config";

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  lida: boolean;
  linkRef: string | null;
  criadaEm: string;
};

function labelDoDia(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sem data";
  if (isToday(d)) return "Hoje";
  if (isYesterday(d)) return "Ontem";
  return format(d, "d 'de' MMMM", { locale: ptBR });
}

function tempoRelativo(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { locale: ptBR, addSuffix: true });
}

function dataCompleta(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Agrupa preservando a ordem vinda da API (mais recentes primeiro). */
function agruparPorDia(itens: Notificacao[]) {
  const grupos: Array<{ label: string; itens: Notificacao[] }> = [];
  for (const n of itens) {
    const label = labelDoDia(n.criadaEm);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.label === label) ultimo.itens.push(n);
    else grupos.push({ label, itens: [n] });
  }
  return grupos;
}

export default function NotificacoesPage() {
  const queryClient = useQueryClient();
  const router = useRouter();

  // refetchOnWindowFocus:true: aba antiga aberta após troca de conta no mesmo
  // browser revalida ao ganhar foco (evita exibir notificações de outra empresa).
  const { data: notificacoes, isLoading } = useQuery<Notificacao[]>({
    queryKey: ["notificacoes"],
    queryFn: () =>
      fetchJSON<{ notificacoes: Notificacao[] }>("/api/notificacoes").then(
        (r) => r.notificacoes,
      ),
    refetchOnWindowFocus: true,
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
  const grupos = agruparPorDia(notificacoes ?? []);

  function abrirNotificacao(n: Notificacao) {
    if (!n.lida) marcarLidaMut.mutate(n.id);
    if (n.linkRef) router.push(n.linkRef as Route);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notificações"
        description={
          naoLidas > 0
            ? `${naoLidas} não ${naoLidas === 1 ? "lida" : "lidas"} · alertas automáticos do sistema`
            : "Alertas automáticos do sistema"
        }
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
        <div className="flex flex-col gap-5">
          {grupos.map((grupo) => (
            <section key={grupo.label} className="space-y-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {grupo.label}
              </h2>
              {grupo.itens.map((n) => {
                const visual = getTipoNotificacaoVisual(n.tipo);
                const Icon = visual.icon;
                const clicavel = !!n.linkRef;

                return (
                  <Card
                    key={n.id}
                    role={clicavel ? "button" : undefined}
                    tabIndex={clicavel ? 0 : undefined}
                    onClick={clicavel ? () => abrirNotificacao(n) : undefined}
                    onKeyDown={
                      clicavel
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              abrirNotificacao(n);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "border-l-4 transition-all",
                      n.lida
                        ? "border-l-transparent opacity-60"
                        : visual.acento,
                      clicavel &&
                        "cursor-pointer hover:-translate-y-px hover:shadow-md",
                    )}
                  >
                    <CardContent className="flex items-start gap-4 py-4">
                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          visual.pastilha,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "text-sm",
                                n.lida ? "font-medium" : "font-semibold",
                              )}
                            >
                              {n.titulo}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {n.descricao}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!n.lida && (
                              <span
                                className="h-2 w-2 rounded-full bg-primary"
                                aria-hidden="true"
                              />
                            )}
                            <Badge variant="outline" className="text-xs">
                              {visual.label}
                            </Badge>
                            {!n.lida && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Marcar como lida"
                                title="Marcar como lida"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  marcarLidaMut.mutate(n.id);
                                }}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span title={dataCompleta(n.criadaEm)}>
                            {tempoRelativo(n.criadaEm)}
                          </span>
                          {clicavel && (
                            <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                              Abrir
                              <ArrowUpRight className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
