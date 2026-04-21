"use client";

import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownRight, ArrowUpRight, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { formatData } from "@/lib/date";
import { cn } from "@/lib/utils";

type Movimentacao = {
  id: string;
  tipo: "ENTRADA" | "SAIDA" | string;
  valor: number;
  dataCaixa: string;
  descricao: string;
  categoria: { nome: string };
};

export function UltimasMovimentacoes() {
  const { data, isLoading } = useQuery<Movimentacao[]>({
    queryKey: ["movimentacoes", "ultimas"],
    queryFn: () => fetchJSON<Movimentacao[]>("/api/movimentacoes"),
  });

  const itens = (data ?? []).slice(0, 6);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Últimas movimentações</h3>
            <p className="text-xs text-muted-foreground">Entradas e saídas recentes</p>
          </div>
        </div>
        <Link
          href={"/caixa" as Route}
          className="flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
        >
          Ir para Caixa <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-md" />
            ))}
          </div>
        )}
        {!isLoading && itens.length === 0 && (
          <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
            Sem movimentações recentes.
          </div>
        )}
        {!isLoading && itens.length > 0 && (
          <ul className="divide-y">
            {itens.map((m) => {
              const isEntrada = m.tipo === "ENTRADA";
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 py-2.5 text-sm"
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      isEntrada
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {isEntrada ? (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatData(new Date(m.dataCaixa))} · {m.categoria.nome}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-sm font-semibold tabular-nums",
                      isEntrada ? "text-success" : "text-destructive",
                    )}
                  >
                    {isEntrada ? "+" : "−"}
                    {formatBRL(m.valor)}
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
