"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { formatBRL, parseValorBRParaCentavos } from "@/lib/money";
import { criarProdutoSchema, type CriarProdutoInput } from "@/modules/estoque/schemas";

type Props = {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  produto?: {
    id: string;
    sku: string;
    asin?: string | null;
    nome: string;
    descricao?: string | null;
    custoUnitario?: number | null;
    precoVenda?: number | null;
    estoqueMinimo: number;
    unidade: string;
    observacoes?: string | null;
  } | null;
};

export function DialogProduto({ aberto, onOpenChange, produto }: Props) {
  const qc = useQueryClient();
  const isEdit = !!produto;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CriarProdutoInput>({
    resolver: zodResolver(criarProdutoSchema),
    defaultValues: { unidade: "un", estoqueMinimo: 0 },
  });

  useEffect(() => {
    if (produto) {
      reset({
        sku: produto.sku,
        asin: produto.asin ?? "",
        nome: produto.nome,
        descricao: produto.descricao ?? "",
        custoUnitario: produto.custoUnitario ?? undefined,
        precoVenda: produto.precoVenda ?? undefined,
        estoqueMinimo: produto.estoqueMinimo,
        unidade: produto.unidade,
        observacoes: produto.observacoes ?? "",
      });
    } else {
      reset({ unidade: "un", estoqueMinimo: 0 });
    }
  }, [produto, reset]);

  const salvar = useMutation({
    mutationFn: async (data: CriarProdutoInput) => {
      if (isEdit) {
        return fetchJSON(`/api/estoque/produtos/${produto!.id}`, {
          method: "PATCH",
          body: JSON.stringify(data),
        });
      }
      return fetchJSON("/api/estoque/produtos", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-totais"] });
      toast.success(isEdit ? "Produto atualizado" : "Produto criado");
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message ?? "Erro ao salvar produto"),
  });

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((d) => salvar.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sku">SKU *</Label>
              <Input
                id="sku"
                {...register("sku")}
                placeholder="EX-001"
                disabled={isEdit}
              />
              {errors.sku && (
                <p className="text-xs text-destructive">{errors.sku.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asin">ASIN</Label>
              <Input id="asin" {...register("asin")} placeholder="B0XXXXXXX" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" {...register("nome")} placeholder="Nome do produto" />
            {errors.nome && (
              <p className="text-xs text-destructive">{errors.nome.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="descricao">Descrição</Label>
            <Input id="descricao" {...register("descricao")} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="custoUnitario">Custo unit. (R$)</Label>
              <Input
                id="custoUnitario"
                type="number"
                step="0.01"
                min="0"
                {...register("custoUnitario", {
                  setValueAs: (v) =>
                    v === "" || v === null ? null : Math.round(parseFloat(v) * 100),
                })}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="precoVenda">Preço venda (R$)</Label>
              <Input
                id="precoVenda"
                type="number"
                step="0.01"
                min="0"
                {...register("precoVenda", {
                  setValueAs: (v) =>
                    v === "" || v === null ? null : Math.round(parseFloat(v) * 100),
                })}
                placeholder="0,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estoqueMinimo">Estoque mín.</Label>
              <Input
                id="estoqueMinimo"
                type="number"
                min="0"
                step="1"
                {...register("estoqueMinimo", { valueAsNumber: true })}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="unidade">Unidade</Label>
            <Input id="unidade" {...register("unidade")} placeholder="un" className="w-32" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="observacoes">Observações</Label>
            <Textarea id="observacoes" {...register("observacoes")} rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
