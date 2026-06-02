"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
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
  custoUnitario: number | null;
  unidade: string;
  statusReposicao: string;
  diasEstoque: number | null;
  dataRuptura: string | null;
  qtdSugerida: number;
};

export type ItemSugerido = {
  produtoId: string;
  quantidade: number;
  custoUnitario: number; // em reais (o form converte para centavos no submit)
};

/**
 * Seção colapsável dentro do "Novo pedido" que traz a inteligência de
 * reposição (cobertura + quantidade sugerida) apenas na hora de comprar,
 * substituindo o antigo mural sempre-visível da aba Compras.
 */
export function SugestorReposicao({
  onAdicionar,
}: {
  onAdicionar: (itens: ItemSugerido[]) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [selecionados, setSelecionados] = React.useState<Record<string, boolean>>({});

  const { data: sugestoes = [], isLoading } = useQuery<Sugestao[]>({
    queryKey: ["compras-sugestoes"],
    queryFn: () => fetchJSON<Sugestao[]>("/api/compras/sugestoes"),
    enabled: aberto,
  });

  const escolhidas = sugestoes.filter((s) => selecionados[s.id]);

  function adicionar() {
    onAdicionar(
      escolhidas.map((s) => ({
        produtoId: s.id,
        quantidade: s.qtdSugerida > 0 ? s.qtdSugerida : 1,
        custoUnitario: (s.custoUnitario ?? 0) / 100,
      })),
    );
    setSelecionados({});
  }

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          Sugerir reposição
        </span>
        {aberto ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {aberto && (
        <div className="border-t px-5 py-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando sugestões…</p>
          ) : sugestoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto precisando de reposição no momento.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                {sugestoes.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={!!selecionados[s.id]}
                      onChange={(e) =>
                        setSelecionados((prev) => ({ ...prev, [s.id]: e.target.checked }))
                      }
                      className="h-4 w-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{s.sku}</span>
                        <Badge
                          variant="outline"
                          className={
                            s.statusReposicao === StatusReposicao.REPOR
                              ? "border-red-300 text-red-700"
                              : "border-amber-300 text-amber-700"
                          }
                        >
                          {s.statusReposicao === StatusReposicao.REPOR ? "Repor" : "Atenção"}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{s.nome}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>
                        Estoque {s.estoqueAtual} · cobre{" "}
                        {s.diasEstoque != null ? `${s.diasEstoque}d` : "—"}
                      </div>
                      <div className="font-medium text-foreground">
                        Sugerido: {s.qtdSugerida} {s.unidade}
                        {s.custoUnitario ? ` · ${formatBRL(s.custoUnitario)}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={escolhidas.length === 0}
                  onClick={adicionar}
                >
                  Adicionar {escolhidas.length > 0 ? `(${escolhidas.length})` : "selecionados"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
