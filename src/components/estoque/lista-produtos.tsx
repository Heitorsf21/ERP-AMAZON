"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Search,
  Plus,
  ArrowUpCircle,
  ArrowDownCircle,
  Pencil,
  PowerOff,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { BadgeReposicao } from "./badge-reposicao";
import { DialogProduto } from "./dialog-produto";
import { DialogMovimentacaoEstoque } from "./dialog-movimentacao-estoque";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import type { StatusReposicao } from "@/modules/shared/domain";

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
};

type FiltroStatus = StatusReposicao | "TODOS";

export function ListaProdutos() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("TODOS");

  useEffect(() => {
    const id = setTimeout(() => setBuscaDebounced(busca), 250);
    return () => clearTimeout(id);
  }, [busca]);
  const [dialogProduto, setDialogProduto] = useState<{
    aberto: boolean;
    produto: Produto | null;
  }>({ aberto: false, produto: null });
  const [dialogMov, setDialogMov] = useState<{
    aberto: boolean;
    produtoId: string;
    nome: string;
  }>({ aberto: false, produtoId: "", nome: "" });

  const params = new URLSearchParams();
  if (buscaDebounced) params.set("busca", buscaDebounced);
  if (filtroStatus !== "TODOS") params.set("statusReposicao", filtroStatus);
  const qs = params.toString();

  const { data: produtos = [], isLoading } = useQuery<Produto[]>({
    queryKey: ["estoque-produtos", buscaDebounced, filtroStatus],
    queryFn: () =>
      fetchJSON<Produto[]>(`/api/estoque/produtos${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
  });

  const desativar = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/estoque/produtos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-totais"] });
      toast.success("Produto desativado");
    },
    onError: () => toast.error("Erro ao desativar produto"),
  });

  const filtrosStatus: { label: string; value: FiltroStatus }[] = [
    { label: "Todos", value: "TODOS" },
    { label: "Repor", value: "REPOR" },
    { label: "Atenção", value: "ATENCAO" },
    { label: "OK", value: "OK" },
  ];

  return (
    <>
      <div className="space-y-4">
        {/* Filtros */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por SKU, nome ou ASIN…"
              className="pl-8 w-72"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
            {filtrosStatus.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFiltroStatus(f.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  filtroStatus === f.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabela */}
        <div className="rounded-xl border">
          {isLoading ? (
            <div className="p-4">
              <DataTableSkeleton rows={6} columns={7} />
            </div>
          ) : produtos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Package className="mb-3 h-10 w-10 opacity-30" />
              <p className="font-medium">Nenhum produto encontrado</p>
              <p className="text-sm">
                {busca
                  ? `Sem resultados para "${busca}"`
                  : "Clique em Novo produto para começar."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">SKU</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="w-[120px]">ASIN</TableHead>
                  <TableHead className="w-[90px] text-right">Estoque</TableHead>
                  <TableHead className="w-[80px] text-right">Mín.</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[110px] text-right">Custo unit.</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtos.map((p) => (
                  <TableRow key={p.id} className="even:bg-muted/30">
                    <TableCell className="font-mono text-xs font-medium">
                      {p.sku}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{p.nome}</div>
                      {p.descricao && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {p.descricao}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.asin ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {p.estoqueAtual} {p.unidade}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {p.estoqueMinimo}
                    </TableCell>
                    <TableCell>
                      <BadgeReposicao status={p.statusReposicao} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-sm text-muted-foreground">
                      {p.custoUnitario ? formatBRL(p.custoUnitario) : "—"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/estoque/${p.id}`}>
                              Ver ficha
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              setDialogMov({
                                aberto: true,
                                produtoId: p.id,
                                nome: p.nome,
                              })
                            }
                          >
                            <ArrowUpCircle className="mr-2 h-4 w-4 text-success" />
                            Registrar entrada
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setDialogMov({
                                aberto: true,
                                produtoId: p.id,
                                nome: p.nome,
                              })
                            }
                          >
                            <ArrowDownCircle className="mr-2 h-4 w-4 text-destructive" />
                            Registrar saída
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              setDialogProduto({ aberto: true, produto: p })
                            }
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => desativar.mutate(p.id)}
                          >
                            <PowerOff className="mr-2 h-4 w-4" />
                            Desativar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <DialogProduto
        aberto={dialogProduto.aberto}
        produto={dialogProduto.produto}
        onOpenChange={(v) => {
          if (!v) setDialogProduto({ aberto: false, produto: null });
          else setDialogProduto((prev) => ({ ...prev, aberto: true }));
        }}
      />

      <DialogMovimentacaoEstoque
        aberto={dialogMov.aberto}
        produtoId={dialogMov.produtoId}
        nomeProduto={dialogMov.nome}
        onOpenChange={(v) => {
          if (!v) setDialogMov({ aberto: false, produtoId: "", nome: "" });
        }}
      />
    </>
  );
}

function Package(props: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
