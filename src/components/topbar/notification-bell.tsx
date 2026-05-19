"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

/**
 * Sino de notificações no topbar — substitui o item "Notificações" da
 * sidebar (Fase 2 do redesign).
 *
 * Comportamento:
 *   - `useQuery(["notificacoes-count"])` mantém o badge atualizado a
 *     cada 60s (mesmo intervalo que a sidebar usava).
 *   - Click abre `<Popover>` com lista das últimas 10 não-lidas.
 *   - Cada item tem botão "marcar como lida" inline.
 *   - Footer "Ver todas" leva para `/notificacoes` (página completa
 *     preservada).
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = React.useState(false);

  const { data: count } = useQuery<{ total: number }>({
    queryKey: ["notificacoes-count"],
    queryFn: () => fetchJSON("/api/notificacoes/contar"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const total = count?.total ?? 0;

  const { data: lista, isLoading } = useQuery<{ notificacoes: Notificacao[] }>({
    queryKey: ["notificacoes-popover"],
    queryFn: () => fetchJSON("/api/notificacoes?naoLidas=true&limit=10"),
    enabled: aberto,
    staleTime: 10_000,
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
      toast.success("Todas marcadas como lidas");
    },
    onError: (err) => toast.error(err.message),
  });

  const notificacoes = lista?.notificacoes ?? [];

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notificações"
          className="relative h-9 w-9"
        >
          <Bell className="h-5 w-5" />
          {total > 0 && (
            <span className="absolute right-1 top-1 grid min-w-[16px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(380px,calc(100vw-2rem))] p-0"
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

        <div className="max-h-80 overflow-y-auto">
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
            </div>
          ) : (
            <ul className="divide-y">
              {notificacoes.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex flex-col gap-1 px-4 py-2.5",
                    !n.lida && "bg-emerald-50/40 dark:bg-emerald-950/10",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                      {n.tipo.replace(/_/g, " ")}
                    </span>
                    <button
                      type="button"
                      onClick={() => marcarLida.mutate(n.id)}
                      disabled={marcarLida.isPending}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      title="Marcar como lida"
                    >
                      ok
                    </button>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {n.titulo}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {n.descricao}
                  </p>
                  <span className="text-[10px] text-muted-foreground/70">
                    {new Date(n.criadaEm).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t px-4 py-2">
          <Link
            href={"/notificacoes" as Route}
            onClick={() => setAberto(false)}
            className="block text-center text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Ver todas as notificações →
          </Link>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
