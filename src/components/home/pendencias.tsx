"use client";

import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Package, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

export function PendenciasFinanceiras() {
  const { data, isLoading } = useQuery<Conta[]>({
    queryKey: ["contas", "proximas"],
    queryFn: () => fetchJSON<Conta[]>("/api/contas?status=ABERTA"),
  });

  const proximas = (data ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime(),
    )
    .slice(0, 5);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Próximos vencimentos</h3>
            <p className="text-xs text-muted-foreground">
              {proximas.length > 0
                ? `${proximas.length} conta(s) a pagar`
                : "nada em aberto"}
            </p>
          </div>
        </div>
        <Link
          href={"/contas-a-pagar" as Route}
          className="flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
        >
          Ver todas <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        )}
        {!isLoading && proximas.length === 0 && (
          <EmptyState mensagem="Nenhuma conta a pagar em aberto." />
        )}
        {!isLoading && proximas.length > 0 && (
          <ul className="divide-y">
            {proximas.map((c) => {
              const dias = diasAteVencimento(c.vencimento);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {c.fornecedor ?? c.descricao}
                    </p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatData(new Date(c.vencimento))}</span>
                      <span className="opacity-50">•</span>
                      <BadgeDias dias={dias} />
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {formatBRL(c.valorCentavos)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type Produto = {
  id: string;
  nome: string;
  sku: string | null;
  estoqueAtual: number;
  estoqueMinimo: number | null;
  statusReposicao: "OK" | "ATENCAO" | "REPOR" | null;
};

export function EstoqueAtencao() {
  const { data, isLoading } = useQuery<Produto[]>({
    queryKey: ["estoque-atencao"],
    queryFn: () => fetchJSON<Produto[]>("/api/estoque/produtos?ativo=true"),
  });

  const itens = (data ?? [])
    .filter((p) => p.statusReposicao === "REPOR" || p.statusReposicao === "ATENCAO")
    .sort((a, b) => {
      if (a.statusReposicao === b.statusReposicao) {
        return a.estoqueAtual - b.estoqueAtual;
      }
      return a.statusReposicao === "REPOR" ? -1 : 1;
    })
    .slice(0, 5);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <Package className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Estoque em atenção</h3>
            <p className="text-xs text-muted-foreground">
              {itens.length > 0
                ? `${itens.length} produto(s)`
                : "tudo em ordem"}
            </p>
          </div>
        </div>
        <Link
          href={"/produtos" as Route}
          className="flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
        >
          Ver produtos <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        )}
        {!isLoading && itens.length === 0 && (
          <EmptyState mensagem="Nenhum produto precisa de atenção agora." />
        )}
        {!isLoading && itens.length > 0 && (
          <ul className="divide-y">
            {itens.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.sku ? `SKU ${p.sku} • ` : ""}
                    estoque {p.estoqueAtual}
                    {p.estoqueMinimo != null && ` / mínimo ${p.estoqueMinimo}`}
                  </p>
                </div>
                <Badge
                  variant={p.statusReposicao === "REPOR" ? "destructive" : "warning"}
                  className="shrink-0 text-[10px] uppercase"
                >
                  {p.statusReposicao === "REPOR" ? "Repor" : "Atenção"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BadgeDias({ dias }: { dias: number }) {
  if (dias < 0) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-destructive">
        <AlertCircle className="h-3 w-3" />
        vencida há {Math.abs(dias)}d
      </span>
    );
  }
  if (dias === 0) return <span className="font-medium text-warning">vence hoje</span>;
  if (dias === 1) return <span className="font-medium text-warning">vence amanhã</span>;
  if (dias <= 7)
    return <span className="font-medium text-warning">em {dias} dia(s)</span>;
  return <span>em {dias} dia(s)</span>;
}

function EmptyState({ mensagem }: { mensagem: string }) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground",
      )}
    >
      {mensagem}
    </div>
  );
}

function diasAteVencimento(iso: string): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(iso);
  venc.setHours(0, 0, 0, 0);
  const diff = venc.getTime() - hoje.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}
