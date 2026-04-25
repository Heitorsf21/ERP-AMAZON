"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJSON } from "@/lib/fetcher";
import {
  formatBRL,
  parseValorBRParaCentavos,
} from "@/lib/money";

type GastoManual = {
  id: string;
  periodoInicio: string;
  periodoFim: string;
  produtoId: string | null;
  valorCentavos: number;
  produto?: { id: string; sku: string; nome: string } | null;
};

type Produto = { id: string; sku: string; nome: string };

function fmtData(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

export function GastoManualSection({ de, ate }: { de: string; ate: string }) {
  const queryClient = useQueryClient();
  const [periodoInicio, setPeriodoInicio] = React.useState(de);
  const [periodoFim, setPeriodoFim] = React.useState(ate);
  const [valor, setValor] = React.useState("");
  const [produtoId, setProdutoId] = React.useState<string>("");

  React.useEffect(() => setPeriodoInicio(de), [de]);
  React.useEffect(() => setPeriodoFim(ate), [ate]);

  const { data: gastos, isLoading } = useQuery<GastoManual[]>({
    queryKey: ["ads-gasto-manual", de, ate],
    queryFn: () =>
      fetchJSON<GastoManual[]>(`/api/ads/gasto-manual?de=${de}&ate=${ate}`),
  });

  const { data: produtos } = useQuery<Produto[]>({
    queryKey: ["estoque-produtos-leve"],
    queryFn: () => fetchJSON<Produto[]>(`/api/estoque/produtos`),
    staleTime: 5 * 60 * 1000,
  });

  const criarMut = useMutation({
    mutationFn: async () => {
      const valorCentavos = parseValorBRParaCentavos(valor);
      if (valorCentavos <= 0) throw new Error("Valor inválido");
      return fetchJSON("/api/ads/gasto-manual", {
        method: "POST",
        body: JSON.stringify({
          periodoInicio,
          periodoFim,
          produtoId: produtoId || null,
          valorCentavos,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Gasto manual cadastrado");
      setValor("");
      setProdutoId("");
      queryClient.invalidateQueries({ queryKey: ["ads-gasto-manual"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerMut = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/ads/gasto-manual/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Gasto removido");
      queryClient.invalidateQueries({ queryKey: ["ads-gasto-manual"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalCentavos =
    gastos?.reduce((acc, g) => acc + g.valorCentavos, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Adicionar gasto manual
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[140px_140px_1fr_140px_auto]">
          <div>
            <Label className="text-xs">Início</Label>
            <Input
              type="date"
              value={periodoInicio}
              onChange={(e) => setPeriodoInicio(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Fim</Label>
            <Input
              type="date"
              value={periodoFim}
              onChange={(e) => setPeriodoFim(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Produto (opcional)</Label>
            <select
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— Geral / sem SKU —</option>
              {produtos?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Valor (R$)</Label>
            <Input
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => criarMut.mutate()}
              disabled={!valor || criarMut.isPending}
            >
              <Plus className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : gastos && gastos.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-12 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gastos.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-sm tabular-nums">
                    {fmtData(g.periodoInicio)} → {fmtData(g.periodoFim)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {g.produto ? (
                      <span>
                        <strong>{g.produto.sku}</strong>{" "}
                        <span className="text-muted-foreground">
                          {g.produto.nome}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">— Geral —</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatBRL(g.valorCentavos)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removerMut.mutate(g.id)}
                      disabled={removerMut.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2} className="text-right text-xs uppercase tracking-wide text-muted-foreground">
                  Total no período
                </TableCell>
                <TableCell className="text-right text-sm font-semibold tabular-nums">
                  {formatBRL(totalCentavos)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
          Nenhum gasto manual cadastrado no período.
        </div>
      )}
    </div>
  );
}
