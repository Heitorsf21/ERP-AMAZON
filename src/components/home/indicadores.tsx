"use client";

import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownToLine,
  Package,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type Saldo = {
  atualCentavos: number;
  comprometidoCentavos: number;
  livreCentavos: number;
  contasEmAberto: number;
  aReceberCentavos: number;
  recebiveisCount: number;
};

type Conta = {
  id: string;
  status: string;
  vencimento: string;
  valorCentavos: number;
};

type EstoqueTotais = {
  countRepor: number;
  countAtencao: number;
};

export function IndicadoresRapidos() {
  const { data: saldo, isLoading: loadingSaldo } = useQuery<Saldo>({
    queryKey: ["saldo"],
    queryFn: () => fetchJSON<Saldo>("/api/movimentacoes/saldo"),
  });

  const { data: vencidas, isLoading: loadingVencidas } = useQuery<Conta[]>({
    queryKey: ["contas", "VENCIDA"],
    queryFn: () => fetchJSON<Conta[]>("/api/contas?status=VENCIDA"),
  });

  const { data: estoque, isLoading: loadingEstoque } = useQuery<EstoqueTotais>({
    queryKey: ["estoque-totais"],
    queryFn: () => fetchJSON<EstoqueTotais>("/api/estoque/totais"),
  });

  const totalVencidasValor = (vencidas ?? []).reduce(
    (acc, c) => acc + c.valorCentavos,
    0,
  );

  const indicadores: Indicador[] = [
    {
      tone: saldo && saldo.livreCentavos < 0 ? "danger" : "default",
      icon: Wallet,
      label: "Saldo livre",
      value: loadingSaldo ? null : formatBRL(saldo?.livreCentavos ?? 0),
      sub:
        saldo && saldo.comprometidoCentavos > 0
          ? `${formatBRL(saldo.comprometidoCentavos)} comprometido`
          : "nada comprometido",
      href: "/financeiro/dashboard" as Route,
    },
    {
      tone:
        (vencidas?.length ?? 0) > 0
          ? "danger"
          : loadingVencidas
            ? "default"
            : "success",
      icon: AlertTriangle,
      label: "Contas vencidas",
      value: loadingVencidas ? null : String(vencidas?.length ?? 0),
      sub: (vencidas?.length ?? 0) > 0 ? formatBRL(totalVencidasValor) : "tudo em dia",
      href: "/contas-a-pagar?status=VENCIDA" as Route,
    },
    {
      tone: "info",
      icon: ArrowDownToLine,
      label: "A receber (Amazon)",
      value: loadingSaldo ? null : formatBRL(saldo?.aReceberCentavos ?? 0),
      sub:
        (saldo?.recebiveisCount ?? 0) > 0
          ? `${saldo?.recebiveisCount} liquidação(ões) pendente(s)`
          : "nenhuma pendência",
      href: "/contas-a-receber" as Route,
    },
    {
      tone:
        (estoque?.countRepor ?? 0) > 0
          ? "warning"
          : loadingEstoque
            ? "default"
            : "success",
      icon: Package,
      label: "Estoque crítico",
      value: loadingEstoque
        ? null
        : String((estoque?.countRepor ?? 0) + (estoque?.countAtencao ?? 0)),
      sub:
        (estoque?.countRepor ?? 0) > 0
          ? `${estoque?.countRepor} repor urgente`
          : "nada em alerta",
      href: "/produtos" as Route,
    },
  ];

  return (
    <section
      aria-label="Indicadores rápidos"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {indicadores.map((i, idx) => (
        <CardIndicador key={i.label} indicador={i} delay={idx * 60} />
      ))}
    </section>
  );
}

type Indicador = {
  tone: "default" | "success" | "warning" | "danger" | "info";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  sub: string;
  href: Route;
};

const toneStyles: Record<
  Indicador["tone"],
  { icon: string; ring: string; accent: string }
> = {
  default: {
    icon: "bg-muted text-muted-foreground",
    ring: "",
    accent: "text-foreground",
  },
  success: {
    icon: "bg-success/10 text-success",
    ring: "",
    accent: "text-success",
  },
  warning: {
    icon: "bg-warning/10 text-warning",
    ring: "ring-1 ring-warning/20",
    accent: "text-warning",
  },
  danger: {
    icon: "bg-destructive/10 text-destructive",
    ring: "ring-1 ring-destructive/20",
    accent: "text-destructive",
  },
  info: {
    icon: "bg-primary/10 text-primary",
    ring: "",
    accent: "text-primary",
  },
};

function CardIndicador({ indicador, delay }: { indicador: Indicador; delay: number }) {
  const { icon: Icon, label, value, sub, href, tone } = indicador;
  const styles = toneStyles[tone];

  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        "animate-in fade-in slide-in-from-bottom-2 fill-mode-both",
        styles.ring,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-transform group-hover:scale-110",
            styles.icon,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3">
        {value === null ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p
            className={cn(
              "text-[22px] font-semibold leading-tight tabular-nums",
              styles.accent,
            )}
          >
            {value}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-primary/60 via-primary to-primary/60 transition-transform duration-300 group-hover:scale-x-100" />
    </Link>
  );
}

export function IndicadorInline({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const map = {
    default: "text-muted-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  };
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn("h-3.5 w-3.5", map[tone])} />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-semibold tabular-nums", map[tone])}>{value}</span>
    </div>
  );
}

export function TrendArrow({ positive }: { positive: boolean }) {
  return (
    <TrendingUp
      className={cn(
        "h-3.5 w-3.5 transition-transform",
        positive ? "text-success" : "-rotate-180 text-destructive",
      )}
    />
  );
}
