"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Globe,
  Package,
  Wallet,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { formatData } from "@/lib/date";
import { cn } from "@/lib/utils";

type Conta = {
  id: string;
  fornecedor: string | null;
  descricao: string;
  valorCentavos: number;
  vencimento: string;
  status: string;
};

type Produto = {
  id: string;
  nome: string;
  sku: string | null;
  estoqueAtual: number;
  estoqueMinimo: number | null;
  statusReposicao: "OK" | "ATENCAO" | "REPOR" | null;
};

type SyncLog = {
  id: string;
  tipo: string;
  status: "SUCESSO" | "ERRO" | "EM_ANDAMENTO" | string;
  iniciadoEm?: string | null;
  finalizadoEm?: string | null;
  createdAt?: string | null;
  erro?: string | null;
  mensagem?: string | null;
};

type Notificacao = {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  lida: boolean;
  linkRef: string | null;
  criadaEm: string;
};

type Severidade = "danger" | "warning";

type Alerta = {
  key: string;
  severidade: Severidade;
  icon: React.ComponentType<{ className?: string }>;
  texto: string;
  detalhe?: string;
  href: Route;
  ordem: number;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_ALERTAS = 5;

export function AlertasCriticos() {
  const vencidasQuery = useQuery<Conta[]>({
    queryKey: ["alertas", "contas-vencidas"],
    queryFn: () => fetchJSON<Conta[]>("/api/contas?status=VENCIDA"),
  });

  const estoqueQuery = useQuery<Produto[]>({
    queryKey: ["alertas", "estoque-repor"],
    queryFn: () => fetchJSON<Produto[]>("/api/estoque/produtos?ativo=true"),
  });

  const amazonQuery = useQuery<SyncLog[]>({
    queryKey: ["alertas", "amazon-status"],
    queryFn: () => fetchJSON<SyncLog[]>("/api/amazon/status"),
  });

  const notifQuery = useQuery<Notificacao[]>({
    queryKey: ["alertas", "notificacoes-nao-lidas"],
    queryFn: () => fetchJSON<Notificacao[]>("/api/notificacoes?naoLidas=true"),
  });

  const isLoading =
    vencidasQuery.isLoading ||
    estoqueQuery.isLoading ||
    amazonQuery.isLoading ||
    notifQuery.isLoading;

  // "agora" estável dentro de cada render para manter o useMemo puro.
  // Atualiza a cada minuto pra refrescar o cálculo de "última sync foi <1h atrás".
  const [agoraMs, setAgoraMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const alertas = React.useMemo<Alerta[]>(() => {
    const lista: Alerta[] = [];

    // 1) Contas vencidas (top 3)
    const vencidas = (vencidasQuery.data ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime(),
      )
      .slice(0, 3);

    for (const c of vencidas) {
      const nome = c.fornecedor ?? c.descricao;
      lista.push({
        key: `vencida:${c.id}`,
        severidade: "danger",
        icon: Wallet,
        texto: `Conta vencida — ${nome}`,
        detalhe: `${formatData(new Date(c.vencimento))} · ${formatBRL(c.valorCentavos)}`,
        href: "/contas-a-pagar?status=VENCIDA" as Route,
        ordem: 0,
      });
    }

    // 2) Estoque crítico (top 3 com REPOR primeiro)
    const estoqueCritico = (estoqueQuery.data ?? [])
      .filter(
        (p) => p.statusReposicao === "REPOR" || p.statusReposicao === "ATENCAO",
      )
      .sort((a, b) => {
        if (a.statusReposicao === b.statusReposicao) {
          return a.estoqueAtual - b.estoqueAtual;
        }
        return a.statusReposicao === "REPOR" ? -1 : 1;
      })
      .slice(0, 3);

    for (const p of estoqueCritico) {
      const isRepor = p.statusReposicao === "REPOR";
      lista.push({
        key: `estoque:${p.id}`,
        severidade: isRepor ? "danger" : "warning",
        icon: Package,
        texto: `Estoque ${isRepor ? "crítico" : "em atenção"} — ${p.sku ?? p.nome}`,
        detalhe: `${p.estoqueAtual} un${
          p.estoqueMinimo != null ? ` / mínimo ${p.estoqueMinimo}` : ""
        }`,
        href: "/produtos" as Route,
        ordem: isRepor ? 1 : 3,
      });
    }

    // 3) Amazon sync com erro (último log com ERRO se for recente <1h)
    const ultimoLog = amazonQuery.data?.[0];
    if (ultimoLog && ultimoLog.status === "ERRO") {
      const quando = ultimoLog.iniciadoEm ?? ultimoLog.createdAt;
      const quandoDate = quando ? new Date(quando) : null;
      const isRecente =
        quandoDate &&
        !Number.isNaN(quandoDate.getTime()) &&
        agoraMs - quandoDate.getTime() < ONE_HOUR_MS;
      if (isRecente && quandoDate) {
        lista.push({
          key: `amazon:${ultimoLog.id}`,
          severidade: "danger",
          icon: Globe,
          texto: `Amazon: última sync (${ultimoLog.tipo}) com erro`,
          detalhe: `há ${formatDistanceToNow(quandoDate, { locale: ptBR })}`,
          href: "/sistema" as Route,
          ordem: 1,
        });
      }
    }

    // 4) Notificações não lidas (top 2 mais recentes)
    const notifs = (notifQuery.data ?? [])
      .filter((n) => !n.lida)
      .sort(
        (a, b) =>
          new Date(b.criadaEm).getTime() - new Date(a.criadaEm).getTime(),
      )
      .slice(0, 2);

    for (const n of notifs) {
      lista.push({
        key: `notif:${n.id}`,
        severidade: "warning",
        icon: Bell,
        texto: n.titulo,
        detalhe: n.descricao,
        href: ((n.linkRef as Route | null) ?? ("/notificacoes" as Route)) as Route,
        ordem: 2,
      });
    }

    // Ordena por severidade (danger primeiro) e ordem original
    return lista
      .sort((a, b) => {
        if (a.severidade !== b.severidade) {
          return a.severidade === "danger" ? -1 : 1;
        }
        return a.ordem - b.ordem;
      })
      .slice(0, MAX_ALERTAS);
  }, [vencidasQuery.data, estoqueQuery.data, amazonQuery.data, notifQuery.data, agoraMs]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Alertas críticos</h3>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? "verificando…"
                : alertas.length > 0
                  ? `${alertas.length} item(ns) precisam da sua atenção`
                  : "nenhum alerta no momento"}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        )}
        {!isLoading && alertas.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-success/5 p-6 text-center">
            <CheckCircle2 className="h-6 w-6 text-success" />
            <p className="text-sm font-medium text-foreground">Tudo em ordem 🎉</p>
            <p className="text-xs text-muted-foreground">
              Sem pendências críticas no momento.
            </p>
          </div>
        )}
        {!isLoading && alertas.length > 0 && (
          <ul className="divide-y">
            {alertas.map((a) => (
              <AlertaItem key={a.key} alerta={a} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AlertaItem({ alerta }: { alerta: Alerta }) {
  const Icon = alerta.icon;
  const isDanger = alerta.severidade === "danger";
  return (
    <li>
      <Link
        href={alerta.href}
        className={cn(
          "group flex items-center gap-3 py-2.5 text-sm transition-colors",
          "hover:bg-muted/40",
        )}
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            isDanger
              ? "bg-destructive/10 text-destructive"
              : "bg-warning/10 text-warning",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            <span
              className={cn(
                "mr-1.5 inline-block h-2 w-2 rounded-full align-middle",
                isDanger ? "bg-destructive" : "bg-warning",
              )}
              aria-hidden
            />
            {alerta.texto}
          </p>
          {alerta.detalhe && (
            <p className="truncate text-xs text-muted-foreground">
              {alerta.detalhe}
            </p>
          )}
        </div>
        <AlertCircle
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
            isDanger ? "text-destructive" : "text-warning",
          )}
        />
      </Link>
    </li>
  );
}
