"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, CheckCircle, AlertTriangle, TrendingDown, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { StatusReposicao } from "@/modules/shared/domain";
import { cn } from "@/lib/utils";

type Sugestao = {
  id: string;
  sku: string;
  nome: string;
  estoqueAtual: number;
  estoqueMinimo: number;
  custoUnitario: number | null;
  unidade: string;
  statusReposicao: string;
  vendido30d: number;
  unidadesPorDia: number;
  diasEstoque: number | null;
  dataRuptura: string | null;
  qtdSugerida: number;
};

function formatDataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function BadgePrioridade({ status }: { status: string }) {
  const repor = status === StatusReposicao.REPOR;
  return (
    <Badge
      variant={repor ? "destructive" : "warning"}
      className="shrink-0 text-[10px]"
    >
      {repor ? "URGENTE" : "ATENÇÃO"}
    </Badge>
  );
}

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
        Todos os produtos estão com estoque para mais de 60 dias de vendas.
      </div>
    );
  }

  const urgentes = sugestoes.filter((s) => s.statusReposicao === StatusReposicao.REPOR);
  const atencao = sugestoes.filter((s) => s.statusReposicao === StatusReposicao.ATENCAO);

  return (
    <div className="space-y-2">
      {urgentes.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <strong>{urgentes.length} produto(s)</strong> com ruptura em menos de 15 dias — reposição urgente.
        </div>
      )}

      <div className="rounded-xl border">
        <div className="grid gap-0 divide-y">
          {sugestoes.map((s) => {
            const custoTotal = s.custoUnitario ? s.custoUnitario * s.qtdSugerida : null;
            const temVelocidade = s.unidadesPorDia > 0;

            return (
              <div
                key={s.id}
                className={cn(
                  "flex items-center justify-between gap-4 px-4 py-3",
                  s.statusReposicao === StatusReposicao.REPOR && "bg-red-50/50 dark:bg-red-900/10",
                )}
              >
                <div className="min-w-0 flex-1">
                  {/* Linha 1: nome + badge */}
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.nome}</span>
                    <BadgePrioridade status={s.statusReposicao} />
                  </div>

                  {/* Linha 2: métricas */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      SKU: <span className="font-mono">{s.sku}</span>
                    </span>
                    <span>
                      Estoque: <strong className="text-foreground">{s.estoqueAtual}</strong> {s.unidade}
                    </span>

                    {temVelocidade ? (
                      <>
                        <span className="flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          <span>
                            <strong className="text-foreground">{s.unidadesPorDia}</strong> un/dia
                          </span>
                        </span>
                        {s.diasEstoque !== null && (
                          <span className={cn(
                            "flex items-center gap-1 font-medium",
                            s.diasEstoque < 15 ? "text-red-600 dark:text-red-400" :
                            s.diasEstoque < 30 ? "text-amber-600 dark:text-amber-400" :
                            "text-foreground",
                          )}>
                            <Clock className="h-3 w-3" />
                            {s.diasEstoque}d restantes
                          </span>
                        )}
                        {s.dataRuptura && (
                          <span>ruptura ~{formatDataCurta(s.dataRuptura)}</span>
                        )}
                      </>
                    ) : (
                      <span>
                        Mín: {s.estoqueMinimo} {s.unidade}
                      </span>
                    )}
                  </div>

                  {/* Linha 3: sugestão de compra */}
                  {s.qtdSugerida > 0 && (
                    <div className="mt-1 text-xs">
                      <span className="text-muted-foreground">Sugerido para 60d: </span>
                      <strong>{s.qtdSugerida} {s.unidade}</strong>
                      {custoTotal && (
                        <span className="text-muted-foreground ml-1">≈ {formatBRL(custoTotal)}</span>
                      )}
                    </div>
                  )}
                </div>

                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/produtos/${s.id}`}>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
