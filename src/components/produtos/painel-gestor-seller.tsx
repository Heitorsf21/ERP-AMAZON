"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  RefreshCw,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import type { ResultadoSyncGS } from "@/lib/gestor-seller-sync";

type MetricaProduto = {
  id: string;
  sku: string;
  titulo: string | null;
  custoUnitarioCentavos: number | null;
  precoVendaCentavos: number | null;
  unidadesVendidasTotais: number;
  vendasAmazonCentavos: number;
  vendasMlCentavos: number;
  vendasShopeeCentavos: number;
  vendasTikTokCentavos: number;
  faturamentoCentavos: number;
  lucroCentavos: number;
  margemPercentual: number;
  custoAdsCentavos: number;
  lucroPosAdsCentavos: number;
  mpaPercentual: number;
  produto: { estoqueAtual: number; asin: string | null; ativo: boolean } | null;
};

type RespostaMetricas = {
  metricas: MetricaProduto[];
  loteId: string | null;
  importadoEm: string | null;
};

type OrdemColuna =
  | "faturamentoCentavos"
  | "lucroCentavos"
  | "mpaPercentual"
  | "margemPercentual"
  | "unidadesVendidasTotais";

function pct(valor: number) {
  return `${valor.toFixed(1)}%`;
}

function MargemBadge({ valor }: { valor: number }) {
  const cor =
    valor >= 20
      ? "text-green-600 bg-green-50"
      : valor >= 10
        ? "text-yellow-600 bg-yellow-50"
        : "text-red-600 bg-red-50";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${cor}`}
    >
      {pct(valor)}
    </span>
  );
}

function SortIcon({
  col,
  ordem,
  asc,
}: {
  col: OrdemColuna;
  ordem: OrdemColuna;
  asc: boolean;
}) {
  if (ordem !== col) return <Minus className="ml-1 h-3 w-3 opacity-30" />;
  return asc ? (
    <ChevronUp className="ml-1 h-3 w-3" />
  ) : (
    <ChevronDown className="ml-1 h-3 w-3" />
  );
}

function SortableHead({
  children,
  col,
  ordem,
  asc,
  onSort,
  className,
}: {
  children: React.ReactNode;
  col: OrdemColuna;
  ordem: OrdemColuna;
  asc: boolean;
  onSort: (col: OrdemColuna) => void;
  className?: string;
}) {
  return (
    <TableHead
      className={`cursor-pointer select-none ${className ?? ""}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center text-xs">
        {children}
        <SortIcon col={col} ordem={ordem} asc={asc} />
      </span>
    </TableHead>
  );
}

export function PainelGestorSeller() {
  const qc = useQueryClient();
  const [ordem, setOrdem] = useState<OrdemColuna>("faturamentoCentavos");
  const [asc, setAsc] = useState(false);

  const { data, isLoading } = useQuery<RespostaMetricas>({
    queryKey: ["estoque-metricas-gs"],
    queryFn: () => fetchJSON<RespostaMetricas>("/api/estoque/metricas-gs"),
  });

  const sync = useMutation<ResultadoSyncGS>({
    mutationFn: () =>
      fetchJSON<ResultadoSyncGS>("/api/estoque/sincronizar-gestor-seller", {
        method: "POST",
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["estoque-metricas-gs"] });
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-totais"] });

      const errosCriticos = r.erros.filter(
        (e) => e.arquivo !== "reports_sales.xlsx",
      );
      if (errosCriticos.length > 0) {
        toast.warning(
          `Sincronizado com avisos: ${errosCriticos.map((e) => e.arquivo).join(", ")}`,
        );
      } else {
        toast.success(
          `Sincronização concluída — ${r.produtosCriados} criados, ${r.produtosAtualizados} atualizados, ${r.estoquesSincronizados} estoques sincronizados`,
        );
      }
    },
    onError: () => toast.error("Erro ao sincronizar com Gestor Seller"),
  });

  function alternarOrdem(col: OrdemColuna) {
    if (ordem === col) setAsc((v) => !v);
    else {
      setOrdem(col);
      setAsc(false);
    }
  }

  const metricas = [...(data?.metricas ?? [])].sort((a, b) => {
    const diff = (a[ordem] as number) - (b[ordem] as number);
    return asc ? diff : -diff;
  });

  const importadoEm = data?.importadoEm
    ? new Date(data.importadoEm).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">
              Performance Gestor Seller
            </CardTitle>
            {importadoEm && (
              <span className="text-xs text-muted-foreground">
                Atualizado {importadoEm}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`}
            />
            {sync.isPending ? "Sincronizando…" : "Sincronizar"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4">
            <DataTableSkeleton rows={5} columns={12} />
          </div>
        ) : metricas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <TrendingUp className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nenhuma métrica importada ainda.</p>
            <p className="text-xs">
              Clique em <strong>Sincronizar</strong> para buscar os relatórios
              do Gestor Seller.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">
                    <span className="text-xs">SKU</span>
                  </TableHead>
                  <TableHead>
                    <span className="text-xs">Produto</span>
                  </TableHead>
                  <SortableHead
                    col="unidadesVendidasTotais"
                    ordem={ordem}
                    asc={asc}
                    onSort={alternarOrdem}
                    className="text-right w-20"
                  >
                    Vendas
                  </SortableHead>
                  <TableHead className="text-right w-24">
                    <span className="text-xs">Custo</span>
                  </TableHead>
                  <TableHead className="text-right w-24">
                    <span className="text-xs">Preço</span>
                  </TableHead>
                  <SortableHead
                    col="faturamentoCentavos"
                    ordem={ordem}
                    asc={asc}
                    onSort={alternarOrdem}
                    className="text-right w-28"
                  >
                    Faturamento
                  </SortableHead>
                  <SortableHead
                    col="lucroCentavos"
                    ordem={ordem}
                    asc={asc}
                    onSort={alternarOrdem}
                    className="text-right w-28"
                  >
                    Lucro
                  </SortableHead>
                  <SortableHead
                    col="margemPercentual"
                    ordem={ordem}
                    asc={asc}
                    onSort={alternarOrdem}
                    className="text-right w-24"
                  >
                    Margem
                  </SortableHead>
                  <TableHead className="text-right w-28">
                    <span className="text-xs">Custo Ads</span>
                  </TableHead>
                  <TableHead className="text-right w-28">
                    <span className="text-xs">Lucro Pós Ads</span>
                  </TableHead>
                  <SortableHead
                    col="mpaPercentual"
                    ordem={ordem}
                    asc={asc}
                    onSort={alternarOrdem}
                    className="text-right w-20"
                  >
                    MPA
                  </SortableHead>
                  <TableHead className="text-right w-20">
                    <span className="text-xs">Estoque</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricas.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {m.sku}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span
                        className="block truncate text-sm"
                        title={m.titulo ?? m.sku}
                      >
                        {m.titulo ?? m.sku}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.unidadesVendidasTotais.toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {m.custoUnitarioCentavos
                        ? formatBRL(m.custoUnitarioCentavos)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {m.precoVendaCentavos
                        ? formatBRL(m.precoVendaCentavos)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatBRL(m.faturamentoCentavos)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-sm font-medium ${m.lucroCentavos >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {formatBRL(m.lucroCentavos)}
                    </TableCell>
                    <TableCell className="text-right">
                      <MargemBadge valor={m.margemPercentual} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {formatBRL(m.custoAdsCentavos)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-xs font-medium ${m.lucroPosAdsCentavos >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {formatBRL(m.lucroPosAdsCentavos)}
                    </TableCell>
                    <TableCell className="text-right">
                      <MargemBadge valor={m.mpaPercentual} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {m.produto?.estoqueAtual ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
