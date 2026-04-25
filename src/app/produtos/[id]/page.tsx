"use client";

import { useState, use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpCircle,
  ArrowDownCircle,
  Pencil,
  Package,
  RefreshCw,
  ShoppingCart,
  ImageOff,
} from "lucide-react";
import { toast } from "sonner";
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
import { BadgeReposicao } from "@/components/produtos/badge-reposicao";
import { DialogProduto } from "@/components/produtos/dialog-produto";
import { DialogMovimentacaoEstoque } from "@/components/produtos/dialog-movimentacao-estoque";
import { FichaAmazon, FichaAmazonKpis } from "@/components/produtos/ficha-amazon";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { resolverImagemProduto } from "@/lib/amazon-images";
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
  imagemUrl: string | null;
  amazonImagemUrl: string | null;
  amazonTituloOficial: string | null;
  amazonEstoqueTotal: number | null;
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

function HeaderImagem({ src, alt }: { src: string | null; alt: string }) {
  const [erro, setErro] = useState(false);
  if (!src || erro) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Package className="h-7 w-7 text-primary" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setErro(true)}
      onLoad={(e) => {
        const w = (e.currentTarget as HTMLImageElement).naturalWidth;
        if (w > 0 && w < 50) setErro(true);
      }}
      className="h-16 w-16 shrink-0 rounded-xl border bg-white object-contain"
    />
  );
}

export default function FichaProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [dialogEdit, setDialogEdit] = useState(false);
  const [dialogMov, setDialogMov] = useState(false);

  const { data: produto, isLoading } = useQuery<Produto>({
    queryKey: ["estoque-produto", id],
    queryFn: () => fetchJSON<Produto>(`/api/estoque/produtos/${id}`),
  });

  const syncCatalog = useMutation({
    mutationFn: () =>
      fetchJSON<{ atualizados: number; erros: string[] }>(
        "/api/amazon/sync-catalog",
        {
          method: "POST",
          body: JSON.stringify({ produtoIds: [id] }),
          headers: { "content-type": "application/json" },
        },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["estoque-produto", id] });
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      if (res.erros.length) {
        toast.warning(`Catálogo sincronizado com erros: ${res.erros[0]}`);
      } else {
        toast.success("Catálogo Amazon atualizado");
      }
    },
    onError: () => toast.error("Erro ao buscar catálogo Amazon"),
  });

  const syncBuybox = useMutation({
    mutationFn: () =>
      fetchJSON<{ atualizados: number; erros: string[] }>(
        "/api/amazon/sync-buybox",
        {
          method: "POST",
          body: JSON.stringify({ produtoIds: [id] }),
          headers: { "content-type": "application/json" },
        },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["estoque-produto", id] });
      qc.invalidateQueries({ queryKey: ["produto-buybox", id] });
      if (res.erros.length) {
        toast.warning(`Buybox com erros: ${res.erros[0]}`);
      } else {
        toast.success("Buybox atualizado");
      }
    },
    onError: () => toast.error("Erro ao buscar buybox"),
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/produtos"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Produtos
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
              <HeaderImagem
                src={
                  produto.imagemUrl
                    ? `/api/produtos/${produto.id}/imagem`
                    : resolverImagemProduto(produto.amazonImagemUrl, produto.asin)
                }
                alt={produto.nome}
              />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">{produto.nome}</h1>
                {produto.amazonTituloOficial &&
                  produto.amazonTituloOficial !== produto.nome && (
                    <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                      {produto.amazonTituloOficial}
                    </p>
                  )}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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
                  <BadgeReposicao status={produto.statusReposicao} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {produto.asin && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncCatalog.mutate()}
                    disabled={syncCatalog.isPending}
                    className="gap-1.5"
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5",
                        syncCatalog.isPending && "animate-spin",
                      )}
                    />
                    Sinc. catálogo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncBuybox.mutate()}
                    disabled={syncBuybox.isPending}
                    className="gap-1.5"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    Sinc. buybox
                  </Button>
                </>
              )}
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

          {/* KPIs (Estoque, FBA, Vendas, Ticket) + 3 cards de margem */}
          <FichaAmazonKpis
            produtoId={produto.id}
            estoqueAtual={produto.estoqueAtual}
            amazonEstoqueTotal={produto.amazonEstoqueTotal}
            precoVenda={produto.precoVenda}
            custoUnitario={produto.custoUnitario}
          />

          {/* Cards Amazon: BuyBox, Vendas, Reembolsos, Reviews */}
          <FichaAmazon produtoId={produto.id} />

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
