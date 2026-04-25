"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
  ShoppingCart,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardDistribuicao,
  type DistribuicaoBolsa,
} from "@/components/destinacao/card-distribuicao";
import { FormPercentuais } from "@/components/destinacao/form-percentuais";
import { CardProjecao } from "@/components/destinacao/card-projecao";
import { KpiCard } from "@/components/ui/kpi-card";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Resumo = {
  saldoAtual: number;
  comprometidoContas: number;
  comprometidoComprasCount: number;
  comprometidoCompras: number;
  totalComprometido: number;
  contasAbertasCount: number;
  aReceber: number;
  aReceberCount: number;
  saldoLivre: number;
  saldoProjetado: number;
  distribuicao: {
    saldo: number;
    percentuais: Record<string, number>;
    configurado: boolean;
    distribuicao: DistribuicaoBolsa[];
    somaPercentuais: number;
  };
};

type BolsaInfo = {
  bolsa: string;
  label: string;
  descricao: string;
  cor: string;
};

type PercentuaisResp = {
  percentuais: Record<string, number>;
  configurado: boolean;
  defaults: Record<string, number>;
  bolsas: BolsaInfo[];
};

type DistribuicaoResp = {
  saldoLivre: number;
  saldoProjetado: number;
  aReceber: number;
  distribuicao: {
    saldo: number;
    percentuais: Record<string, number>;
    configurado: boolean;
    distribuicao: DistribuicaoBolsa[];
    somaPercentuais: number;
  };
  projecao: {
    mediaDiariaCentavos: number;
    baseHistoricoDias: number;
    janelas: Array<{
      dias: number;
      receitaProjetada: number;
      saldoProjetado: number;
      distribuicao: Record<string, number>;
    }>;
  };
};

export default function DestinacaoPage() {
  const resumoQuery = useQuery<Resumo>({
    queryKey: ["destinacao-resumo"],
    queryFn: () => fetchJSON<Resumo>("/api/destinacao/resumo"),
    refetchInterval: 60_000,
  });

  const percentuaisQuery = useQuery<PercentuaisResp>({
    queryKey: ["destinacao-percentuais"],
    queryFn: () => fetchJSON<PercentuaisResp>("/api/destinacao/percentuais"),
  });

  const distribuicaoQuery = useQuery<DistribuicaoResp>({
    queryKey: ["destinacao-distribuicao"],
    queryFn: () => fetchJSON<DistribuicaoResp>("/api/destinacao/distribuicao"),
    refetchInterval: 60_000,
  });

  const loading =
    resumoQuery.isLoading ||
    percentuaisQuery.isLoading ||
    distribuicaoQuery.isLoading;

  if (loading || !resumoQuery.data || !percentuaisQuery.data || !distribuicaoQuery.data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const data = resumoQuery.data;
  const pct = percentuaisQuery.data;
  const dist = distribuicaoQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Destinação de Caixa"
        description="Saldo livre, distribuição planejada e projeções de caixa."
      />

      {/* Topo: 4 KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Saldo Atual em Caixa"
          value={formatBRL(data.saldoAtual)}
          icon={Wallet}
          color="blue"
        />
        <KpiCard
          label="Comprometido"
          value={formatBRL(data.totalComprometido)}
          sub={`${data.contasAbertasCount} contas + ${data.comprometidoComprasCount} pedidos`}
          icon={TrendingDown}
          color="red"
        />
        <KpiCard
          label="A Receber Amazon"
          value={formatBRL(data.aReceber)}
          sub={`${data.aReceberCount} liquidação(ões)`}
          icon={Clock}
          color="green"
        />
        <KpiCard
          label="Saldo Livre Projetado"
          value={formatBRL(data.saldoProjetado)}
          sub="Livre + a receber"
          icon={TrendingUp}
          color={data.saldoProjetado >= 0 ? "green" : "red"}
          highlight
        />
      </div>

      {/* Detalhe rápido do saldo livre (sem A Receber) */}
      <div
        className={cn(
          "rounded-xl border px-4 py-3 text-xs",
          data.saldoLivre >= 0
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : "border-destructive/20 bg-destructive/5 text-destructive",
        )}
      >
        <span className="font-medium">Saldo livre hoje:</span>{" "}
        <span className="font-semibold tabular-nums">{formatBRL(data.saldoLivre)}</span>
        <span className="ml-1 opacity-80">
          (caixa − contas a pagar − pedidos confirmados)
        </span>
      </div>

      {/* Distribuição + Form lado a lado */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CardDistribuicao
          distribuicao={dist.distribuicao.distribuicao}
          saldoBase={dist.distribuicao.saldo}
          somaPercentuais={dist.distribuicao.somaPercentuais}
          configurado={dist.distribuicao.configurado}
        />
        <FormPercentuais
          bolsas={pct.bolsas}
          percentuaisIniciais={pct.percentuais}
          defaults={pct.defaults}
        />
      </div>

      {/* Projeção 30/60/90 */}
      <CardProjecao
        bolsas={pct.bolsas}
        janelas={dist.projecao.janelas}
        mediaDiariaCentavos={dist.projecao.mediaDiariaCentavos}
        baseHistoricoDias={dist.projecao.baseHistoricoDias}
      />

      {/* Detalhe de comprometimento */}
      <div className="rounded-xl border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold">Detalhe do comprometimento</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailRow
            icon={TrendingDown}
            label="Contas a pagar em aberto"
            value={formatBRL(data.comprometidoContas)}
            sub={`${data.contasAbertasCount} conta(s)`}
            tone="red"
          />
          <DetailRow
            icon={ShoppingCart}
            label="Pedidos de compra confirmados"
            value={formatBRL(data.comprometidoCompras)}
            sub={`${data.comprometidoComprasCount} pedido(s)`}
            tone="orange"
          />
          <DetailRow
            icon={PiggyBank}
            label="Total comprometido"
            value={formatBRL(data.totalComprometido)}
            tone="red"
          />
          <DetailRow
            icon={Clock}
            label="A receber Amazon"
            value={formatBRL(data.aReceber)}
            sub={`${data.aReceberCount} liquidação(ões)`}
            tone="green"
          />
        </div>
      </div>
    </div>
  );
}

const colorMap = {
  blue: "text-primary bg-primary/10",
  green: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
  red: "text-destructive bg-destructive/10",
  orange: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
};

function DetailRow({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone: "blue" | "green" | "red" | "orange";
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background/40 p-3">
      <div className={cn("rounded-md p-2", colorMap[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
