"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, BellOff, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

function tempoRelativo(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNow(date, { locale: ptBR, addSuffix: true });
}

/**
 * Sino de notificações no topbar — único canal de aviso do sistema.
 *
 * Comportamento:
 *   - `useQuery(["notificacoes-count"])` mantém o badge atualizado a
 *     cada 60s; quando a contagem SOBE, o sino balança uma vez
 *     (keyframe `bell-ring` em globals.css).
 *   - Click abre `<Popover>` com lista das últimas 10 não-lidas.
 *   - Item com `linkRef` navega ao destino e é marcado como lido.
 *   - Footer "Ver todas" leva para `/notificacoes`.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [tocando, setTocando] = React.useState(false);
  const totalAnterior = React.useRef<number | null>(null);

  // refetchOnWindowFocus:true: aba antiga aberta após troca de conta no mesmo
  // browser revalida ao ganhar foco (evita exibir notificações de outra empresa).
  const { data: count } = useQuery<{ total: number }>({
    queryKey: ["notificacoes-count"],
    queryFn: () => fetchJSON("/api/notificacoes/contar"),
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const total = count?.total ?? 0;

  // Aviso visual: balança o sino quando surgem não-lidas novas (ou ao
  // entrar no app já com pendências).
  React.useEffect(() => {
    const anterior = totalAnterior.current;
    totalAnterior.current = total;
    if (total > (anterior ?? 0)) {
      setTocando(true);
      const timer = setTimeout(() => setTocando(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [total]);

  const { data: lista, isLoading } = useQuery<{ notificacoes: Notificacao[] }>({
    queryKey: ["notificacoes-popover"],
    queryFn: () => fetchJSON("/api/notificacoes?naoLidas=true&limit=10"),
    enabled: aberto,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const marcarLida = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notificacoes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lida: true }),
      });
      if (!res.ok) throw new Error("Erro ao marcar como lida");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificacoes-count"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes-popover"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const marcarTodas = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notificacoes/marcar-todas-lidas", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Erro ao marcar todas como lidas");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificacoes-count"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes-popover"] });
      queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
      toast.success("Todas marcadas como lidas");
    },
    onError: (err) => toast.error(err.message),
  });

  const notificacoes = lista?.notificacoes ?? [];

  function abrirNotificacao(n: Notificacao) {
    if (!n.lida) marcarLida.mutate(n.id);
    setAberto(false);
    if (n.linkRef) router.push(n.linkRef as Route);
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            total > 0 ? `Notificações — ${total} não lidas` : "Notificações"
          }
          className="relative h-9 w-9"
        >
          <Bell
            className={cn(
              "h-5 w-5",
              tocando && "animate-[bell-ring_0.9s_ease-in-out]",
            )}
          />
          {total > 0 && (
            <span className="absolute right-1 top-1 grid min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(400px,calc(100vw-2rem))] p-0"
      >
        <header className="flex items-center justify-between border-b px-4 py-2.5">
          <div>
            <h3 className="text-sm font-semibold">Notificações</h3>
            <p className="text-[11px] text-muted-foreground">
              {total === 0
                ? "Nenhuma não-lida"
                : `${total} não-${total === 1 ? "lida" : "lidas"}`}
            </p>
          </div>
          {total > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => marcarTodas.mutate()}
              disabled={marcarTodas.isPending}
            >
              <CheckCheck className="mr-1 h-3 w-3" />
              Marcar todas
            </Button>
          )}
        </header>

        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : notificacoes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <BellOff className="h-6 w-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Sem novas notificações
              </p>
              <p className="text-xs text-muted-foreground/70">
                Você está em dia. 🎉
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {notificacoes.map((n) => {
                const visual = getTipoNotificacaoVisual(n.tipo);
                const Icon = visual.icon;
                const clicavel = !!n.linkRef;

                return (
                  <li key={n.id}>
                    <div
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
                        "group flex items-start gap-3 px-4 py-3 transition-colors",
                        clicavel && "cursor-pointer hover:bg-accent/60",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          visual.pastilha,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="truncate text-sm font-medium leading-tight text-foreground">
                          {n.titulo}
                        </p>
                        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {n.descricao}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70">
                          {visual.label} · {tempoRelativo(n.criadaEm)}
                        </p>
                      </div>

                      <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        <span
                          className="h-2 w-2 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            marcarLida.mutate(n.id);
                          }}
                          disabled={marcarLida.isPending}
                          aria-label="Marcar como lida"
                          title="Marcar como lida"
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t px-4 py-2">
          <Link
            href={"/notificacoes" as Route}
            onClick={() => setAberto(false)}
            className="block text-center text-xs font-medium text-primary hover:underline"
          >
            Ver todas as notificações →
          </Link>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
