"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
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
    imagemUrl?: string | null;
  } | null;
};

export function DialogProduto({ aberto, onOpenChange, produto }: Props) {
  const qc = useQueryClient();
  const isEdit = !!produto;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagemPreview, setImagemPreview] = useState<string | null>(null);

  useEffect(() => {
    if (produto?.imagemUrl) {
      // Cache-bust pra refletir upload recente
      setImagemPreview(`/api/produtos/${produto.id}/imagem?v=${Date.now()}`);
    } else {
      setImagemPreview(null);
    }
  }, [produto]);

  const uploadImagem = useMutation({
    mutationFn: async (file: File) => {
      if (!produto?.id) throw new Error("Salve o produto antes de subir imagem.");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/produtos/${produto.id}/imagem`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.erro ?? "Erro no upload");
      }
      return res.json();
    },
    onSuccess: () => {
      if (produto?.id) {
        setImagemPreview(`/api/produtos/${produto.id}/imagem?v=${Date.now()}`);
      }
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-produto", produto?.id] });
      toast.success("Imagem atualizada");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const removerImagem = useMutation({
    mutationFn: async () => {
      if (!produto?.id) return;
      const res = await fetch(`/api/produtos/${produto.id}/imagem`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erro ao remover imagem");
    },
    onSuccess: () => {
      setImagemPreview(null);
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-produto", produto?.id] });
      toast.success("Imagem removida");
    },
    onError: (err) => toast.error((err as Error).message),
  });

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

          {isEdit && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <Label>Imagem do produto</Label>
              <div className="flex items-center gap-3">
                {imagemPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imagemPreview}
                    alt="Preview"
                    className="h-16 w-16 rounded-md border object-contain bg-white"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadImagem.mutate(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={uploadImagem.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                    {uploadImagem.isPending
                      ? "Enviando..."
                      : imagemPreview
                        ? "Trocar imagem"
                        : "Carregar imagem"}
                  </Button>
                  {imagemPreview && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={removerImagem.isPending}
                      onClick={() => removerImagem.mutate()}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5 text-destructive" />
                      Remover
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                JPG/PNG/WEBP, até 5MB. Aparece em /produtos e na ficha.
              </p>
            </div>
          )}

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
