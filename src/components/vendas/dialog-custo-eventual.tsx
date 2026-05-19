"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseValorBRParaCentavos } from "@/lib/money";

/**
 * Dialog para registrar um custo eventual ad-hoc em uma venda específica.
 *
 * Os custos vivem em `VendaCustoEventual` (modelo separado de `VendaAmazon`)
 * e são somados pelo `montarBreakdownVendas` em runtime, sem nunca tocar
 * os campos sagrados de `VendaAmazon`.
 */
export function DialogCustoEventual({
  vendaId,
  trigger,
}: {
  vendaId: string;
  trigger?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [descricao, setDescricao] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [erroValor, setErroValor] = React.useState<string | null>(null);

  const criar = useMutation({
    mutationFn: async (input: { descricao: string; valorCentavos: number }) => {
      const res = await fetch(`/api/vendas/${vendaId}/custos-eventuais`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.erro ?? "Erro ao adicionar custo");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendas"] });
      toast.success("Custo eventual adicionado");
      reset();
      setAberto(false);
    },
    onError: (err) => toast.error(err.message),
  });

  function reset() {
    setDescricao("");
    setValor("");
    setErroValor(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!descricao.trim()) return;

    let valorCentavos: number;
    try {
      valorCentavos = parseValorBRParaCentavos(valor);
    } catch {
      setErroValor("Valor inválido");
      return;
    }
    if (valorCentavos <= 0) {
      setErroValor("Valor deve ser maior que zero");
      return;
    }
    setErroValor(null);

    criar.mutate({ descricao: descricao.trim(), valorCentavos });
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) reset();
        setAberto(v);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <Plus className="mr-1 h-3 w-3" />
            Adicionar custo eventual
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar custo eventual</DialogTitle>
          <DialogDescription>
            Lance um custo ad-hoc para esta venda (ex: frete de devolução,
            embalagem extra, ajuste manual). O valor desconta do lucro do
            pedido.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="custo-descricao">Descrição</Label>
            <Input
              id="custo-descricao"
              placeholder="ex: Frete de devolução"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={120}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custo-valor">Valor (R$)</Label>
            <Input
              id="custo-valor"
              placeholder="0,00"
              inputMode="decimal"
              value={valor}
              onChange={(e) => {
                setValor(e.target.value);
                setErroValor(null);
              }}
              required
            />
            {erroValor && (
              <p className="text-xs text-destructive">{erroValor}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAberto(false)}
              disabled={criar.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
