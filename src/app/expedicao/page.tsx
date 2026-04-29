"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, PackageCheck, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type PickingItem = {
  id: string;
  amazonOrderId: string;
  sku: string;
  asin: string | null;
  titulo: string | null;
  quantidade: number;
  status: string;
  checklistJson: string | null;
};

type PickingBatch = {
  id: string;
  codigo: string;
  status: string;
  etiquetaUrl: string | null;
  observacoes: string | null;
  criadoEm: string;
  itens: PickingItem[];
};

export default function ExpedicaoPage() {
  const qc = useQueryClient();
  const [batchSelecionadoId, setBatchSelecionadoId] = useState<string | null>(null);

  const { data: batches = [], isLoading } = useQuery<PickingBatch[]>({
    queryKey: ["fbm-picking-batches"],
    queryFn: () => fetchJSON<PickingBatch[]>("/api/expedicao/fbm/picking"),
    staleTime: 30_000,
  });

  const batchSelecionado = useMemo(
    () => batches.find((b) => b.id === batchSelecionadoId) ?? batches[0] ?? null,
    [batches, batchSelecionadoId],
  );

  const criar = useMutation({
    mutationFn: () =>
      fetchJSON<{ batch: PickingBatch | null; itensCriados: number; mensagem?: string }>(
        "/api/expedicao/fbm/picking",
        { method: "POST", body: JSON.stringify({ limite: 50, diasAtras: 14 }) },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["fbm-picking-batches"] });
      if (res.batch) {
        setBatchSelecionadoId(res.batch.id);
        toast.success(`${res.itensCriados} item(ns) adicionados ao lote FBM`);
      } else {
        toast.info(res.mensagem ?? "Nenhuma venda FBM pendente");
      }
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const atualizarItem = useMutation({
    mutationFn: ({
      batchId,
      itemId,
      status,
    }: {
      batchId: string;
      itemId: string;
      status: string;
    }) =>
      fetchJSON(`/api/expedicao/fbm/picking/${batchId}/itens/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fbm-picking-batches"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const atualizarBatch = useMutation({
    mutationFn: ({ batchId, status }: { batchId: string; status: string }) =>
      fetchJSON(`/api/expedicao/fbm/picking/${batchId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fbm-picking-batches"] });
      toast.success("Lote atualizado");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const totais = useMemo(() => {
    const itens = batchSelecionado?.itens ?? [];
    return {
      itens: itens.length,
      unidades: itens.reduce((sum, item) => sum + item.quantidade, 0),
      conferidos: itens.filter((item) => item.status === "CONFERIDO").length,
    };
  }, [batchSelecionado]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expedicao"
        description="Picking e packing FBM baseado em pedidos Amazon ja sincronizados."
      >
        <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
          <Plus className="mr-2 h-4 w-4" />
          {criar.isPending ? "Criando..." : "Criar lote FBM"}
        </Button>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Truck className="h-4 w-4 text-muted-foreground" />
              Lotes
            </div>
          </div>
          <div className="divide-y">
            {isLoading && (
              <div className="px-4 py-8 text-sm text-muted-foreground">
                Carregando...
              </div>
            )}
            {!isLoading && batches.length === 0 && (
              <div className="px-4 py-8 text-sm text-muted-foreground">
                Nenhum lote FBM criado.
              </div>
            )}
            {batches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setBatchSelecionadoId(batch.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/60",
                  batchSelecionado?.id === batch.id && "bg-muted",
                )}
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold">{batch.codigo}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(batch.criadoEm).toLocaleString("pt-BR")}
                  </div>
                </div>
                <StatusBadge status={batch.status} />
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card">
          {batchSelecionado ? (
            <>
              <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-mono text-base font-semibold">
                      {batchSelecionado.codigo}
                    </h2>
                    <StatusBadge status={batchSelecionado.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{totais.itens} itens</span>
                    <span>{totais.unidades} unidades</span>
                    <span>{totais.conferidos} conferidos</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={atualizarBatch.isPending}
                    onClick={() =>
                      atualizarBatch.mutate({
                        batchId: batchSelecionado.id,
                        status: "EM_SEPARACAO",
                      })
                    }
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Separar
                  </Button>
                  <Button
                    size="sm"
                    disabled={atualizarBatch.isPending}
                    onClick={() =>
                      atualizarBatch.mutate({
                        batchId: batchSelecionado.id,
                        status: "DESPACHADO",
                      })
                    }
                  >
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Despachar
                  </Button>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Checklist</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchSelecionado.itens.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        {item.amazonOrderId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell>
                        <div className="max-w-[360px] truncate text-sm">
                          {item.titulo ?? item.asin ?? "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {item.quantidade}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={item.status === "CONFERIDO" ? "outline" : "secondary"}
                          disabled={atualizarItem.isPending}
                          onClick={() =>
                            atualizarItem.mutate({
                              batchId: batchSelecionado.id,
                              itemId: item.id,
                              status:
                                item.status === "CONFERIDO" ? "PENDENTE" : "CONFERIDO",
                            })
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {item.status === "CONFERIDO" ? "Reabrir" : "Conferir"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              Crie um lote FBM para iniciar a separacao.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "DESPACHADO" || status === "CONFERIDO"
      ? "default"
      : status === "CANCELADO" || status === "DIVERGENTE"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
