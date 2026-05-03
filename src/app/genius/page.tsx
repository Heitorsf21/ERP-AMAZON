"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeDollarSign,
  Boxes,
  DollarSign,
  Lightbulb,
  PackageSearch,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingDown,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { GeniusResponse, Sugestao, TipoSugestao } from "@/app/api/genius/sugestoes/route";
import Link from "next/link";

// ── Metadados de tipo ───────────────────────────────────────────────────────

type TipoMeta = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeClass: string;
  borderClass: string;
  iconBgClass: string;
};

const TIPO_META: Record<TipoSugestao, TipoMeta> = {
  RESTOCK: {
    label: "Restock",
    icon: Boxes,
    badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    borderClass: "border-l-red-500",
    iconBgClass: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  BUYBOX_PERDIDO: {
    label: "BuyBox",
    icon: TrendingDown,
    badgeClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    borderClass: "border-l-orange-500",
    iconBgClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  ACOS_ALTO: {
    label: "Ads",
    icon: Tag,
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    borderClass: "border-l-amber-500",
    iconBgClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  RETURNS_ALTO: {
    label: "Devoluções",
    icon: RotateCcw,
    badgeClass: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    borderClass: "border-l-violet-500",
    iconBgClass: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  CUSTO_AUSENTE: {
    label: "Custo",
    icon: DollarSign,
    badgeClass: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20",
    borderClass: "border-l-slate-400",
    iconBgClass: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  REIMBURSEMENT_RECEBIDO: {
    label: "Ressarcimento",
    icon: BadgeDollarSign,
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    borderClass: "border-l-emerald-500",
    iconBgClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

const TIPO_LABELS: Record<TipoSugestao, string> = {
  RESTOCK: "Restock",
  BUYBOX_PERDIDO: "BuyBox",
  ACOS_ALTO: "Ads (ACOS)",
  RETURNS_ALTO: "Devoluções",
  CUSTO_AUSENTE: "Custo",
  REIMBURSEMENT_RECEBIDO: "Ressarcimento",
};

const FILTROS: Array<{ value: TipoSugestao | "TODOS" }> = [
  { value: "TODOS" },
  { value: "RESTOCK" },
  { value: "BUYBOX_PERDIDO" },
  { value: "ACOS_ALTO" },
  { value: "RETURNS_ALTO" },
  { value: "CUSTO_AUSENTE" },
  { value: "REIMBURSEMENT_RECEBIDO" },
];

// ── Componente do card de sugestão ─────────────────────────────────────────

function SugestaoCard({ s }: { s: Sugestao }) {
  const meta = TIPO_META[s.tipo];
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "flex gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/5",
        "border-l-[3px]",
        meta.borderClass,
      )}
    >
      <div className={cn("mt-0.5 shrink-0 rounded-lg p-2 h-fit", meta.iconBgClass)}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-start gap-2">
          <span className="text-sm font-semibold leading-tight">{s.titulo}</span>
          <Badge variant="outline" className={cn("text-[10px] font-medium px-1.5 py-0", meta.badgeClass)}>
            {meta.label}
          </Badge>
          {s.prioridade >= 80 && (
            <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
              Urgente
            </Badge>
          )}
        </div>

        {s.sku && (
          <p className="text-[11px] font-mono text-muted-foreground">{s.sku}</p>
        )}
        {s.nomeProduto && (
          <p className="text-xs text-muted-foreground line-clamp-1">{s.nomeProduto}</p>
        )}

        <p className="text-sm text-muted-foreground">{s.descricao}</p>

        <div className="flex flex-wrap items-center gap-3 pt-0.5">
          <div className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1">
            <Lightbulb className="h-3 w-3 text-amber-500" />
            <span className="text-[11px] text-foreground/80">{s.acaoSugerida}</span>
          </div>
          {s.impactoCentavos != null && s.impactoCentavos > 0 && (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {s.tipo === "REIMBURSEMENT_RECEBIDO" ? "+" : ""}
              {formatBRL(s.impactoCentavos)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Skeletons ──────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-7 w-20" />
      <Skeleton className="h-3 w-36" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 flex gap-4">
      <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-64" />
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────

export default function GeniusPage() {
  const [filtro, setFiltro] = React.useState<TipoSugestao | "TODOS">("TODOS");

  const { data, isLoading, error, refetch } = useQuery<GeniusResponse>({
    queryKey: ["genius-sugestoes"],
    queryFn: () => fetchJSON("/api/genius/sugestoes"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const sugestoesFiltradas = React.useMemo(() => {
    if (!data?.sugestoes) return [];
    if (filtro === "TODOS") return data.sugestoes;
    return data.sugestoes.filter((s) => s.tipo === filtro);
  }, [data, filtro]);

  const contsPorTipo = React.useMemo(() => {
    if (!data?.sugestoes) return {} as Record<string, number>;
    return data.sugestoes.reduce(
      (acc, s) => {
        acc[s.tipo] = (acc[s.tipo] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [data]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Genius Pro"
        description="Sugestões priorizadas baseadas em dados reais do seu negócio."
      >
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <Zap className="mr-2 h-3.5 w-3.5" />
          Atualizar
        </Button>
      </PageHeader>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : error ? (
          <div className="col-span-full rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Erro ao carregar sugestões. Tente recarregar.
          </div>
        ) : (
          <>
            <KpiCard
              label="Total de sugestões"
              value={String(data?.totais.total ?? 0)}
              sub={`${data?.totais.urgente ?? 0} urgentes`}
              icon={PackageSearch}
              color="blue"
            />
            <KpiCard
              label="Restock pendente"
              value={String(data?.totais.restockCount ?? 0)}
              sub="SKUs abaixo do mínimo"
              icon={ShoppingCart}
              color="red"
            />
            <KpiCard
              label="Sem custo"
              value={String(data?.totais.semCustoCount ?? 0)}
              sub="produtos sem margem"
              icon={DollarSign}
              color="slate"
            />
            <KpiCard
              label="Ressarcimentos (7d)"
              value={formatBRL(data?.totais.reimbursementTotalCentavos ?? 0)}
              sub="FBA reembolsado"
              icon={BadgeDollarSign}
              color="green"
            />
            <KpiCard
              label="Perda em devoluções"
              value={formatBRL(data?.totais.returnsTotalCentavos ?? 0)}
              sub="estimado 30 dias"
              icon={RotateCcw}
              color="orange"
            />
            <KpiCard
              label="Urgentes"
              value={String(data?.totais.urgente ?? 0)}
              sub="prioridade alta"
              icon={AlertTriangle}
              color="red"
              highlight={(data?.totais.urgente ?? 0) > 0}
            />
          </>
        )}
      </div>

      {/* Filtros */}
      {!isLoading && !error && (
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => {
            const count =
              f.value === "TODOS"
                ? data?.totais.total ?? 0
                : contsPorTipo[f.value] ?? 0;
            const label = f.value === "TODOS" ? "Todos" : TIPO_LABELS[f.value as TipoSugestao];
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFiltro(f.value as TipoSugestao | "TODOS")}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  filtro === f.value
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    filtro === f.value
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Lista de sugestões */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
        ) : error ? null : sugestoesFiltradas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-10 text-center">
            <div className="rounded-full bg-emerald-500/10 p-3">
              <Sparkles className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Tudo certo por aqui!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhuma sugestão para o filtro selecionado no momento.
              </p>
            </div>
          </div>
        ) : (
          sugestoesFiltradas.map((s) => <SugestaoCard key={s.id} s={s} />)
        )}
      </div>

      {/* Atalhos rápidos */}
      {!isLoading && !error && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Atalhos rápidos
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { href: "/estoque", label: "Editar custos", icon: DollarSign },
              { href: "/compras", label: "Novo pedido", icon: ShoppingCart },
              { href: "/publicidade", label: "Ver campanhas", icon: Tag },
              { href: "/vendas", label: "Analisar vendas", icon: ArrowUpRight },
            ].map((a) => {
              const Icon = a.icon;
              return (
                <Link key={a.href} href={a.href}>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {a.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
