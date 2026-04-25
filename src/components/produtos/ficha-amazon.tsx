"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  CheckCircle2,
  XCircle,
  ShoppingCart,
  MailCheck,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type VendasResposta = {
  totalUnidades: number;
  totalLiquidoCentavos: number;
  ticketMedioCentavos: number;
  transacoes: number;
  porDia: Array<{ data: string; quantidade: number; receitaCentavos: number }>;
};

type ReembolsosResposta = {
  total: number;
  qtdDevolvida: number;
  valorReembolsadoCentavos: number;
  percentualReembolso: number;
  porMotivo: Array<{ motivoCategoria: string; quantidade: number; valor: number }>;
};

type BuyboxResposta = {
  snapshots: Array<{
    capturadoEm: string;
    somosBuybox: boolean;
    precoNosso: number | null;
    precoBuybox: number | null;
    sellerBuybox: string | null;
  }>;
  percentualTempo: number;
  mediaPrecoBuybox: number | null;
  totalSnapshots: number;
};

type ReviewsResposta = {
  pendentes: number;
  enviadas: number;
  total: number;
  proximasElegiveis: Array<{ amazonOrderId: string; eligibleFrom: string }>;
};


const CORES_PIE = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

function formatDataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function FichaAmazon({ produtoId }: { produtoId: string }) {
  const { data: vendas, isLoading: loadingVendas } = useQuery<VendasResposta>({
    queryKey: ["produto-vendas", produtoId],
    queryFn: () =>
      fetchJSON<VendasResposta>(`/api/produtos/${produtoId}/vendas?dias=30`),
    staleTime: 5 * 60 * 1000,
  });

  const { data: reembolsos, isLoading: loadingReembolsos } = useQuery<ReembolsosResposta>({
    queryKey: ["produto-reembolsos", produtoId],
    queryFn: () =>
      fetchJSON<ReembolsosResposta>(`/api/produtos/${produtoId}/reembolsos?dias=30`),
    staleTime: 5 * 60 * 1000,
  });

  const { data: buybox, isLoading: loadingBuybox } = useQuery<BuyboxResposta>({
    queryKey: ["produto-buybox", produtoId],
    queryFn: () =>
      fetchJSON<BuyboxResposta>(`/api/produtos/${produtoId}/buybox-historico?dias=15`),
    staleTime: 5 * 60 * 1000,
  });

  const { data: reviews, isLoading: loadingReviews } = useQuery<ReviewsResposta>({
    queryKey: ["produto-reviews", produtoId],
    queryFn: () =>
      fetchJSON<ReviewsResposta>(`/api/produtos/${produtoId}/reviews-pendentes`),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-6">
      {/* Card BuyBox grande */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Buybox — últimos 15 dias
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingBuybox ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : buybox && buybox.totalSnapshots > 0 ? (
            <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    % do tempo com Buybox
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-3xl font-semibold tabular-nums",
                      buybox.percentualTempo >= 80
                        ? "text-emerald-600 dark:text-emerald-400"
                        : buybox.percentualTempo >= 50
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {buybox.percentualTempo.toFixed(1)}%
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {buybox.totalSnapshots} snapshot(s)
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Status atual
                  </p>
                  {(() => {
                    const ultimo = buybox.snapshots[buybox.snapshots.length - 1];
                    if (!ultimo) return null;
                    return (
                      <div className="mt-1 flex items-center gap-2">
                        {ultimo.somosBuybox ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <XCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        )}
                        <span className="text-sm font-medium">
                          {ultimo.somosBuybox ? "Ganhando" : "Perdendo"}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {buybox.mediaPrecoBuybox != null && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Preço médio do buybox
                    </p>
                    <p className="mt-1 font-mono text-lg font-medium tabular-nums">
                      {formatBRL(buybox.mediaPrecoBuybox)}
                    </p>
                  </div>
                )}
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={buybox.snapshots.map((s) => ({
                      data: formatDataCurta(s.capturadoEm),
                      precoNosso: s.precoNosso ? s.precoNosso / 100 : null,
                      precoBuybox: s.precoBuybox ? s.precoBuybox / 100 : null,
                    }))}
                    margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => `R$${v.toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(v: number) =>
                        `R$ ${v.toFixed(2).replace(".", ",")}`
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="precoNosso"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      name="Nosso preço"
                    />
                    <Line
                      type="monotone"
                      dataKey="precoBuybox"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={false}
                      name="Buybox"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sem snapshots de buybox nos últimos 15 dias.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Vendas + Reembolsos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              Vendas — últimos 30 dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingVendas ? (
              <Skeleton className="h-48 w-full" />
            ) : vendas && vendas.porDia.length > 0 ? (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={vendas.porDia.map((d) => ({
                      data: formatDataCurta(d.data),
                      quantidade: d.quantidade,
                    }))}
                    margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="quantidade" fill="#3b82f6" name="Unidades" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem vendas nos últimos 30 dias.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <XCircle className="h-4 w-4 text-destructive" />
              Reembolsos — últimos 30 dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingReembolsos ? (
              <Skeleton className="h-48 w-full" />
            ) : reembolsos && reembolsos.porMotivo.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={reembolsos.porMotivo}
                        dataKey="quantidade"
                        nameKey="motivoCategoria"
                        cx="50%"
                        cy="50%"
                        outerRadius={60}
                        innerRadius={32}
                      >
                        {reembolsos.porMotivo.map((_, i) => (
                          <Cell key={i} fill={CORES_PIE[i % CORES_PIE.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="mb-2 grid grid-cols-3 gap-2 border-b pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>Motivo</span>
                    <span className="text-right">Qtd</span>
                    <span className="text-right">Valor</span>
                  </div>
                  {reembolsos.porMotivo.slice(0, 6).map((m, i) => (
                    <div
                      key={m.motivoCategoria}
                      className="grid grid-cols-3 items-center gap-2"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: CORES_PIE[i % CORES_PIE.length] }}
                        />
                        <span className="truncate" title={m.motivoCategoria}>
                          {m.motivoCategoria}
                        </span>
                      </span>
                      <span className="text-right font-mono tabular-nums">
                        {m.quantidade}
                      </span>
                      <span className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatBRL(m.valor)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
                    Taxa de reembolso:{" "}
                    <strong
                      className={cn(
                        reembolsos.percentualReembolso >= 5
                          ? "text-red-600"
                          : reembolsos.percentualReembolso >= 2
                            ? "text-amber-600"
                            : "text-foreground",
                      )}
                    >
                      {reembolsos.percentualReembolso.toFixed(1)}%
                    </strong>
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum reembolso nos últimos 30 dias.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reviews + Métricas GS */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MailCheck className="h-4 w-4 text-primary" />
              Solicitação de reviews
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingReviews ? (
              <Skeleton className="h-20 w-full" />
            ) : reviews ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Pendentes
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {reviews.pendentes}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Enviadas
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {reviews.enviadas}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Total
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">
                      {reviews.total}
                    </p>
                  </div>
                </div>

                {reviews.proximasElegiveis.length > 0 && (
                  <div className="border-t pt-3">
                    <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Próximas elegíveis
                    </p>
                    <ul className="space-y-1 text-xs">
                      {reviews.proximasElegiveis.slice(0, 5).map((r) => (
                        <li
                          key={r.amazonOrderId}
                          className="flex items-center justify-between"
                        >
                          <span className="font-mono text-muted-foreground">
                            {r.amazonOrderId}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDataHora(r.eligibleFrom)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Sem dados de reviews.
              </p>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

export function FichaAmazonKpis({
  produtoId,
  estoqueAtual,
  amazonEstoqueTotal,
  precoVenda,
  custoUnitario,
}: {
  produtoId: string;
  estoqueAtual: number;
  amazonEstoqueTotal: number | null;
  precoVenda: number | null;
  custoUnitario: number | null;
}) {
  const { data: vendas } = useQuery<VendasResposta>({
    queryKey: ["produto-vendas", produtoId],
    queryFn: () =>
      fetchJSON<VendasResposta>(`/api/produtos/${produtoId}/vendas?dias=30`),
    staleTime: 5 * 60 * 1000,
  });

  const margemCentavos =
    precoVenda != null && custoUnitario != null
      ? precoVenda - custoUnitario
      : null;
  const margemPct =
    margemCentavos != null && precoVenda && precoVenda > 0
      ? (margemCentavos / precoVenda) * 100
      : null;

  return (
    <>
      {/* 4 KPIs principais */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Estoque atual
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {estoqueAtual}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              FBA total
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {amazonEstoqueTotal ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Vendas 30d
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {vendas?.totalUnidades ?? <Skeleton className="h-7 w-12" />}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Ticket médio
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {vendas?.ticketMedioCentavos
                ? formatBRL(vendas.ticketMedioCentavos)
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 3 cards de margem */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Preço de venda
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {precoVenda ? formatBRL(precoVenda) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Custo unitário
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {custoUnitario ? formatBRL(custoUnitario) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Margem
            </p>
            <p
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                margemPct == null
                  ? ""
                  : margemPct >= 20
                    ? "text-emerald-600 dark:text-emerald-400"
                    : margemPct >= 10
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400",
              )}
            >
              {margemPct != null ? `${margemPct.toFixed(1)}%` : "—"}
            </p>
            {margemCentavos != null && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatBRL(margemCentavos)} / un
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
