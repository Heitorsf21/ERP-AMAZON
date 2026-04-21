"use client";

import * as React from "react";
import { use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, Package, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { BadgeStatusPedido } from "@/components/compras/badge-status-pedido";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { formatData } from "@/lib/date";
import { StatusPedidoCompra } from "@/modules/shared/domain";

type ItemDetalhe = {
  id: string;
  quantidade: number;
  custoUnitario: number;
  subtotal: number;
  produto: { id: string; sku: string; nome: string; unidade: string; estoqueAtual: number };
};

type PedidoDetalhe = {
  id: string;
  numero: string | null;
  status: string;
  dataEmissao: string;
  dataPrevisao: string | null;
  dataRecebimento: string | null;
  totalCentavos: number;
  observacoes: string | null;
  fornecedor: { id: string; nome: string } | null;
  contaPagar: { id: string; descricao: string; status: string; vencimento: string } | null;
  itens: ItemDetalhe[];
};

export default function FichaPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();

  const { data: pedido, isLoading } = useQuery<PedidoDetalhe>({
    queryKey: ["compra", id],
    queryFn: () => fetchJSON<PedidoDetalhe>(`/api/compras/${id}`),
  });

  const confirmar = useMutation({
    mutationFn: () =>
      fetchJSON(`/api/compras/${id}/confirmar`, {
        method: "POST",
        body: JSON.stringify({ criarContaPagar: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compra", id] });
      qc.invalidateQueries({ queryKey: ["compras"] });
      toast.success("Pedido confirmado! Conta a pagar criada.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao confirmar"),
  });

  const receber = useMutation({
    mutationFn: () =>
      fetchJSON(`/api/compras/${id}/receber`, {
        method: "POST",
        body: JSON.stringify({
          dataRecebimento: new Date().toISOString().slice(0, 10),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compra", id] });
      qc.invalidateQueries({ queryKey: ["compras"] });
      qc.invalidateQueries({ queryKey: ["estoque-totais"] });
      toast.success("Mercadoria recebida! Estoque atualizado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao receber"),
  });

  const cancelar = useMutation({
    mutationFn: () =>
      fetchJSON(`/api/compras/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compras"] });
      toast.success("Pedido cancelado.");
      window.location.href = "/compras";
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao cancelar"),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!pedido) {
    return <p className="text-muted-foreground">Pedido não encontrado.</p>;
  }

  const isRascunho = pedido.status === StatusPedidoCompra.RASCUNHO;
  const isConfirmado = pedido.status === StatusPedidoCompra.CONFIRMADO;
  const isAtivo = isRascunho || isConfirmado;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Pedido ${pedido.numero ?? pedido.id.slice(0, 8).toUpperCase()}`}
        description={`Emitido em ${formatData(new Date(pedido.dataEmissao))}`}
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/compras">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Link>
          </Button>

          {isRascunho && (
            <Button
              size="sm"
              onClick={() => confirmar.mutate()}
              disabled={confirmar.isPending}
            >
              {confirmar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <CheckCircle className="mr-2 h-4 w-4" />
              Confirmar Pedido
            </Button>
          )}
          {isConfirmado && (
            <Button
              size="sm"
              onClick={() => receber.mutate()}
              disabled={receber.isPending}
            >
              {receber.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Package className="mr-2 h-4 w-4" />
              Marcar como Recebido
            </Button>
          )}
          {isAtivo && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {cancelar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <XCircle className="mr-2 h-4 w-4" />
              Cancelar
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Info cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Status">
          <BadgeStatusPedido status={pedido.status} />
        </InfoCard>
        <InfoCard label="Fornecedor">
          {pedido.fornecedor?.nome ?? "—"}
        </InfoCard>
        <InfoCard label="Previsão de Entrega">
          {pedido.dataPrevisao ? formatData(new Date(pedido.dataPrevisao)) : "—"}
        </InfoCard>
        <InfoCard label="Total do Pedido">
          <span className="text-lg font-bold">{formatBRL(pedido.totalCentavos)}</span>
        </InfoCard>
      </div>

      {pedido.contaPagar && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
          <span className="font-medium">Conta a pagar: </span>
          <span className="text-muted-foreground">
            {pedido.contaPagar.descricao} · vence{" "}
            {formatData(new Date(pedido.contaPagar.vencimento))} ·{" "}
            <span className="font-mono">{pedido.contaPagar.status}</span>
          </span>
        </div>
      )}

      {pedido.observacoes && (
        <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          {pedido.observacoes}
        </p>
      )}

      {/* Itens */}
      <div className="rounded-xl border bg-card">
        <div className="border-b px-5 py-3">
          <h3 className="text-sm font-semibold">Itens do Pedido</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU / Produto</TableHead>
              <TableHead className="w-[100px]">Estoque</TableHead>
              <TableHead className="w-[100px]">Qtd</TableHead>
              <TableHead className="w-[150px]">Custo Unit.</TableHead>
              <TableHead className="w-[130px] text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pedido.itens.map((item) => (
              <TableRow key={item.id} className="even:bg-muted/20">
                <TableCell>
                  <div className="font-medium">{item.produto.nome}</div>
                  <div className="text-xs text-muted-foreground">{item.produto.sku}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {item.produto.estoqueAtual} {item.produto.unidade}
                </TableCell>
                <TableCell className="font-medium">
                  {item.quantidade} {item.produto.unidade}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {formatBRL(item.custoUnitario)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  {formatBRL(item.subtotal)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={4} className="text-right font-semibold text-sm">
                Total
              </TableCell>
              <TableCell className="text-right font-bold font-mono">
                {formatBRL(pedido.totalCentavos)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function InfoCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}
