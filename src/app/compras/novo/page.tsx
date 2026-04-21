"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";

const itemSchema = z.object({
  produtoId: z.string().min(1, "Produto obrigatório"),
  quantidade: z.coerce.number().int().positive("Mínimo 1"),
  custoUnitario: z.coerce.number().nonnegative(),
});

const formSchema = z.object({
  numero: z.string().optional(),
  fornecedorId: z.string().optional(),
  dataEmissao: z.string().min(1, "Data obrigatória"),
  dataPrevisao: z.string().optional(),
  observacoes: z.string().optional(),
  itens: z.array(itemSchema).min(1, "Adicione pelo menos 1 item"),
});

type FormValues = z.infer<typeof formSchema>;

type Produto = { id: string; sku: string; nome: string; custoUnitario: number | null; unidade: string };
type Fornecedor = { id: string; nome: string };

function centavosParaReais(centavos: number | null | undefined) {
  if (!centavos) return "";
  return (centavos / 100).toFixed(2);
}

export default function NovoPedidoPage() {
  const router = useRouter();

  const { data: produtos = [] } = useQuery<Produto[]>({
    queryKey: ["produtos-ativos"],
    queryFn: () => fetchJSON<Produto[]>("/api/estoque/produtos?ativo=true"),
  });

  const { data: fornecedores = [] } = useQuery<Fornecedor[]>({
    queryKey: ["fornecedores"],
    queryFn: () => fetchJSON<Fornecedor[]>("/api/fornecedores"),
  });

  const hoje = new Date().toISOString().slice(0, 10);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dataEmissao: hoje,
      itens: [{ produtoId: "", quantidade: 1, custoUnitario: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "itens",
  });

  const criar = useMutation({
    mutationFn: (data: FormValues) => {
      const payload = {
        ...data,
        itens: data.itens.map((item) => ({
          ...item,
          custoUnitario: Math.round(item.custoUnitario * 100),
        })),
      };
      return fetchJSON("/api/compras", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast.success("Pedido criado com sucesso");
      router.push("/compras");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar pedido"),
  });

  const itens = form.watch("itens");
  const total = itens.reduce(
    (sum, item) =>
      sum + (Number(item.quantidade) || 0) * (Number(item.custoUnitario) || 0),
    0,
  );

  function preencherCusto(index: number, produtoId: string) {
    const produto = produtos.find((p) => p.id === produtoId);
    if (produto?.custoUnitario) {
      form.setValue(`itens.${index}.custoUnitario`, produto.custoUnitario / 100);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Novo Pedido de Compra"
        description="Registre uma ordem de compra de produtos."
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/compras">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Link>
        </Button>
      </PageHeader>

      <form onSubmit={form.handleSubmit((d) => criar.mutate(d))} className="space-y-6">
        {/* Dados básicos */}
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold">Informações do Pedido</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label>Número / Ref. (opcional)</Label>
              <Input placeholder="Ex: PO-2026-001" {...form.register("numero")} />
            </div>
            <div className="space-y-1">
              <Label>Fornecedor (opcional)</Label>
              <Select {...form.register("fornecedorId")}>
                <option value="">Selecione…</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Data do Pedido *</Label>
              <Input type="date" {...form.register("dataEmissao")} />
              {form.formState.errors.dataEmissao && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.dataEmissao.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Previsão de Entrega</Label>
              <Input type="date" {...form.register("dataPrevisao")} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Observações</Label>
              <Input placeholder="Notas internas…" {...form.register("observacoes")} />
            </div>
          </div>
        </div>

        {/* Itens */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Itens do Pedido</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ produtoId: "", quantidade: 1, custoUnitario: 0 })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar item
            </Button>
          </div>

          {form.formState.errors.itens?.root && (
            <p className="mb-3 text-xs text-destructive">
              {form.formState.errors.itens.root.message}
            </p>
          )}

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-[110px]">Qtd</TableHead>
                  <TableHead className="w-[150px]">Custo Unit. (R$)</TableHead>
                  <TableHead className="w-[130px] text-right">Subtotal</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, index) => {
                  const qty = Number(form.watch(`itens.${index}.quantidade`)) || 0;
                  const custo = Number(form.watch(`itens.${index}.custoUnitario`)) || 0;
                  const subtotal = qty * custo;
                  return (
                    <TableRow key={field.id}>
                      <TableCell>
                        <Controller
                          control={form.control}
                          name={`itens.${index}.produtoId`}
                          render={({ field: f }) => (
                            <Select
                              value={f.value}
                              onChange={(e) => {
                                f.onChange(e);
                                preencherCusto(index, e.target.value);
                              }}
                            >
                              <option value="">Selecione…</option>
                              {produtos.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.sku} — {p.nome}
                                </option>
                              ))}
                            </Select>
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          {...form.register(`itens.${index}.quantidade`)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0,00"
                          {...form.register(`itens.${index}.custoUnitario`)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-sm">
                        {formatBRL(Math.round(subtotal * 100))}
                      </TableCell>
                      <TableCell>
                        {fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex justify-end">
            <div className="text-sm">
              <span className="text-muted-foreground">Total estimado: </span>
              <span className="font-bold text-foreground">
                {formatBRL(Math.round(total * 100))}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => router.push("/compras")}>
            Cancelar
          </Button>
          <Button type="submit" disabled={criar.isPending}>
            {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar Rascunho
          </Button>
        </div>
      </form>
    </div>
  );
}
