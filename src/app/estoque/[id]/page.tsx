"use client";

import { useState, use } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpCircle,
  ArrowDownCircle,
  Pencil,
  Package,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { BadgeReposicao } from "@/components/estoque/badge-reposicao";
import { DialogProduto } from "@/components/estoque/dialog-produto";
import { DialogMovimentacaoEstoque } from "@/components/estoque/dialog-movimentacao-estoque";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { StatusReposicao } from "@/modules/shared/domain";

type Movimentacao = {
  id: string;
  tipo: string;
  quantidade: number;
  custoUnitario: number | null;
  origem: string;
  observacoes: string | null;
  dataMovimentacao: string;
};

type Produto = {
  id: string;
  sku: string;
  asin: string | null;
  nome: string;
  descricao: string | null;
  custoUnitario: number | null;
  precoVenda: number | null;
  estoqueAtual: number;
  estoqueMinimo: number;
  unidade: string;
  ativo: boolean;
  observacoes: string | null;
  statusReposicao: StatusReposicao;
  movimentacoes: Movimentacao[];
};

function formatData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function FichaProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [dialogEdit, setDialogEdit] = useState(false);
  const [dialogMov, setDialogMov] = useState(false);

  const { data: produto, isLoading } = useQuery<Produto>({
    queryKey: ["estoque-produto", id],
    queryFn: () => fetchJSON<Produto>(`/api/estoque/produtos/${id}`),
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/estoque"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Estoque
        </Link>
        <span>/</span>
        <span className="text-foreground">
          {isLoading ? "…" : produto?.nome ?? id}
        </span>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <DataTableSkeleton rows={3} columns={4} />
        </div>
      )}

      {produto && (
        <>
          {/* Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Package className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold">{produto.nome}</h1>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-mono">{produto.sku}</span>
                  {produto.asin && (
                    <>
                      <span>·</span>
                      <span className="font-mono">{produto.asin}</span>
                    </>
                  )}
                  {!produto.ativo && (
                    <Badge variant="outline" className="ml-1">
                      Inativo
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDialogMov(true)}
                className="gap-1.5"
              >
                <ArrowUpCircle className="h-4 w-4 text-success" />
                Movimentação
              </Button>
              <Button variant="outline" onClick={() => setDialogEdit(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
            </div>
          </div>

          {/* Info cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Estoque atual
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {produto.estoqueAtual}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    {produto.unidade}
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Estoque mínimo
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {produto.estoqueMinimo}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Status reposição
                </p>
                <div className="mt-2">
                  <BadgeReposicao status={produto.statusReposicao} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Custo unitário
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {produto.custoUnitario ? formatBRL(produto.custoUnitario) : "—"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Histórico de movimentações */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Histórico de movimentações</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {produto.movimentacoes.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma movimentação registrada.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Custo unit.</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead>Observações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produto.movimentacoes.map((m) => (
                      <TableRow key={m.id} className="even:bg-muted/30">
                        <TableCell className="text-sm text-muted-foreground">
                          {formatData(m.dataMovimentacao)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {m.tipo === "ENTRADA" ? (
                              <ArrowUpCircle className="h-4 w-4 text-success" />
                            ) : (
                              <ArrowDownCircle className="h-4 w-4 text-destructive" />
                            )}
                            <span
                              className={cn(
                                "text-sm font-medium",
                                m.tipo === "ENTRADA"
                                  ? "text-success"
                                  : "text-destructive",
                              )}
                            >
                              {m.tipo === "ENTRADA" ? "Entrada" : "Saída"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono font-semibold tabular-nums",
                            m.tipo === "ENTRADA"
                              ? "text-success"
                              : "text-destructive",
                          )}
                        >
                          {m.tipo === "ENTRADA" ? "+" : "-"}
                          {m.quantidade}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground tabular-nums">
                          {m.custoUnitario ? formatBRL(m.custoUnitario) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">
                          {m.origem.toLowerCase()}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.observacoes ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {produto && (
        <>
          <DialogProduto
            aberto={dialogEdit}
            produto={produto}
            onOpenChange={setDialogEdit}
          />
          <DialogMovimentacaoEstoque
            aberto={dialogMov}
            produtoId={produto.id}
            nomeProduto={produto.nome}
            onOpenChange={setDialogMov}
          />
        </>
      )}
    </div>
  );
}
