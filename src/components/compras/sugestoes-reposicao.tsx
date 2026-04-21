"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { StatusReposicao } from "@/modules/shared/domain";

type Sugestao = {
  id: string;
  sku: string;
  nome: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  custoUnitario: number | null;
  unidade: string;
  statusReposicao: string;
};

export function SugestoesReposicao() {
  const { data: sugestoes = [], isLoading } = useQuery<Sugestao[]>({
    queryKey: ["compras-sugestoes"],
    queryFn: () => fetchJSON<Sugestao[]>("/api/compras/sugestoes"),
  });

  if (isLoading) {
    return <div className="h-16 animate-pulse rounded-lg bg-muted/40" />;
  }

  if (sugestoes.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-muted-foreground">
        <CheckCircle className="h-5 w-5 text-success" />
        Todos os produtos estão com estoque adequado.
      </div>
    );
  }

  return (
    <div className="rounded-xl border">
      <div className="grid gap-0 divide-y">
        {sugestoes.map((s) => {
          const repor = s.statusReposicao === StatusReposicao.REPOR;
          const qtdSugerida = Math.max(
            s.estoqueMinimo * 2 - s.estoqueAtual,
            s.estoqueMinimo,
          );
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.nome}</span>
                  <Badge
                    variant={repor ? "destructive" : "warning"}
                    className="shrink-0 text-[10px]"
                  >
                    {repor ? "REPOR" : "ATENÇÃO"}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {s.sku} · Estoque: {s.estoqueAtual}/{s.estoqueMinimo} {s.unidade} · sugerido:{" "}
                  <strong>{qtdSugerida} {s.unidade}</strong>
                  {s.custoUnitario && (
                    <span className="ml-1">
                      ≈ {formatBRL(s.custoUnitario * qtdSugerida)}
                    </span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/estoque/${s.id}`}>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
