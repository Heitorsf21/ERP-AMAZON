"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import {
  TipoMovimentacaoEstoque,
  OrigemMovimentacaoEstoque,
} from "@/modules/shared/domain";

type Props = {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  produtoId: string;
  nomeProduto: string;
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export function DialogMovimentacaoEstoque({
  aberto,
  onOpenChange,
  produtoId,
  nomeProduto,
}: Props) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<string>(TipoMovimentacaoEstoque.ENTRADA);
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [data, setData] = useState(hojeISO());

  const registrar = useMutation({
    mutationFn: () =>
      fetchJSON(`/api/estoque/produtos/${produtoId}/movimentacoes`, {
        method: "POST",
        body: JSON.stringify({
          tipo,
          quantidade: parseInt(quantidade, 10),
          custoUnitario: custo
            ? Math.round(parseFloat(custo) * 100)
            : null,
          origem: OrigemMovimentacaoEstoque.MANUAL,
          observacoes: observacoes || null,
          dataMovimentacao: data,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-produto", produtoId] });
      qc.invalidateQueries({ queryKey: ["estoque-movimentacoes", produtoId] });
      qc.invalidateQueries({ queryKey: ["estoque-totais"] });
      toast.success(
        tipo === TipoMovimentacaoEstoque.ENTRADA
          ? "Entrada registrada"
          : "Saída registrada",
      );
      onOpenChange(false);
      setQuantidade("");
      setCusto("");
      setObservacoes("");
      setData(hojeISO());
    },
    onError: (err) => toast.error((err as Error).message ?? "Erro ao registrar"),
  });

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar movimentação</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{nomeProduto}</p>

          {/* Tipo */}
          <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1">
            {[TipoMovimentacaoEstoque.ENTRADA, TipoMovimentacaoEstoque.SAIDA].map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    "rounded-md py-2 text-sm font-medium transition-all",
                    tipo === t
                      ? t === TipoMovimentacaoEstoque.ENTRADA
                        ? "bg-success text-white shadow-sm"
                        : "bg-destructive text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === TipoMovimentacaoEstoque.ENTRADA ? "Entrada" : "Saída"}
                </button>
              ),
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantidade *</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Custo unit. (R$)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Observações</Label>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              placeholder="Opcional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!quantidade || registrar.isPending}
            onClick={() => registrar.mutate()}
          >
            {registrar.isPending ? "Registrando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
