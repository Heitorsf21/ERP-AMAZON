"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  Search,
  Plus,
  ArrowUpCircle,
  ArrowDownCircle,
  Pencil,
  PowerOff,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShoppingCart,
  ImageOff,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { BadgeReposicao } from "./badge-reposicao";
import { DialogProduto } from "./dialog-produto";
import { DialogMovimentacaoEstoque } from "./dialog-movimentacao-estoque";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
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
  amazonEstoqueDisponivel: number | null;
  amazonEstoqueReservado: number | null;
  amazonEstoqueInbound: number | null;
  amazonEstoqueTotal: number | null;
  amazonUltimaSyncEm: string | null;
  // B1 — Catálogo
  amazonImagemUrl: string | null;
  amazonTituloOficial: string | null;
  amazonCategoria: string | null;
  amazonCatalogSyncEm: string | null;
  // B2 — Buybox
  buyboxGanho: boolean | null;
  buyboxPreco: number | null;
  buyboxConcorrentes: number | null;
  buyboxUltimaSyncEm: string | null;
  estoqueMinimo: number;
  unidade: string;
  ativo: boolean;
  observacoes: string | null;
  statusReposicao: StatusReposicao;
};

type VelocidadeProduto = {
  produtoId: string;
  sku: string;
  vendido30d: number;
  unidadesPorDia: number;
  diasEstoque: number | null;
  criticidade: "OK" | "ATENCAO" | "CRITICO" | "SEM_VENDAS";
};

type FiltroStatus = StatusReposicao | "TODOS";

function exportarCSV(produtos: Produto[], velocidades: Map<string, VelocidadeProduto>) {
  const linhas = [
    ["SKU", "Nome", "ASIN", "Estoque", "Estoque Mín.", "Custo Unit. (R$)", "Status", "Dias Estoque"],
    ...produtos.map((p) => {
      const vel = velocidades.get(p.id);
      return [
        p.sku,
        p.nome,
        p.asin ?? "",
        String(p.estoqueAtual),
        String(p.estoqueMinimo),
        p.custoUnitario ? (p.custoUnitario / 100).toFixed(2) : "",
        p.statusReposicao,
        vel?.diasEstoque != null ? String(vel.diasEstoque) : "",
      ];
    }),
  ];

  const csv = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `estoque_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// ── Buybox Popover ───────────────────────────────────────────────────────────

function BuyboxPopover({
  produto,
  onSyncBuybox,
  isSyncing,
}: {
  produto: Produto;
  onSyncBuybox: (id: string) => void;
  isSyncing: boolean;
}) {
  const temDados = produto.buyboxUltimaSyncEm !== null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center rounded text-xs transition",
            temDados
              ? produto.buyboxGanho
                ? "text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                : "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
              : "text-muted-foreground hover:bg-muted",
          )}
          title="Ver status do Buybox"
        >
          <ShoppingCart className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Buybox — {produto.asin}
        </p>

        {temDados ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {produto.buyboxGanho ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              <span className={cn(
                "text-sm font-medium",
                produto.buyboxGanho
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-amber-700 dark:text-amber-300",
              )}>
                {produto.buyboxGanho ? "Ganhando o Buybox" : "Perdendo o Buybox"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Preço buybox</span>
              <span className="text-right font-mono font-medium">
                {produto.buyboxPreco ? formatBRL(produto.buyboxPreco) : "—"}
              </span>
              <span className="text-muted-foreground">Concorrentes</span>
              <span className="text-right font-mono">
                {produto.buyboxConcorrentes ?? "—"}
              </span>
              {produto.precoVenda && produto.buyboxPreco && (
                <>
                  <span className="text-muted-foreground">Seu preço</span>
                  <span className="text-right font-mono">
                    {formatBRL(produto.precoVenda)}
                  </span>
                </>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Sync: {formatDataCurta(produto.buyboxUltimaSyncEm)}
            </p>
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">
            Sem dados de buybox. Clique para sincronizar.
          </p>
        )}

        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 w-full gap-1.5 text-xs"
          disabled={isSyncing}
          onClick={() => onSyncBuybox(produto.id)}
        >
          <RefreshCw className={cn("h-3 w-3", isSyncing && "animate-spin")} />
          {isSyncing ? "Atualizando…" : "Atualizar buybox"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ── Thumbnail do produto ─────────────────────────────────────────────────────

function ProdutoThumbnail({
  src,
  alt,
  title,
}: {
  src: string | null;
  alt: string;
  title: string | null;
}) {
  const [erro, setErro] = useState(false);

  if (!src || erro) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-muted">
        <ImageOff className="h-3.5 w-3.5 text-muted-foreground/50" />
      </span>
    );
  }

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setErro(true)}
      className="h-8 w-8 shrink-0 rounded border object-contain bg-white"
    />
  );

  if (!title) return img;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{img}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[240px] text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

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

  const { data: velocidades = [] } = useQuery<VelocidadeProduto[]>({
    queryKey: ["estoque-velocidade"],
    queryFn: () => fetchJSON<VelocidadeProduto[]>("/api/estoque/velocidade"),
    staleTime: 5 * 60 * 1000,
  });

  const velocidadePorId = new Map(velocidades.map((v) => [v.produtoId, v]));
  const semCusto = produtos.filter((p) => !p.custoUnitario).length;

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

  const atualizarCusto = useMutation({
    mutationFn: ({
      id,
      custoUnitario,
    }: {
      id: string;
      custoUnitario: number | null;
    }) =>
      fetchJSON(`/api/estoque/produtos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ custoUnitario }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      qc.invalidateQueries({ queryKey: ["estoque-totais"] });
      toast.success("Custo unitario atualizado");
    },
    onError: (err) =>
      toast.error((err as Error).message ?? "Erro ao atualizar custo"),
  });

  const syncCatalog = useMutation({
    mutationFn: (produtoId: string) =>
      fetchJSON<{ atualizados: number; erros: string[] }>("/api/amazon/sync-catalog", {
        method: "POST",
        body: JSON.stringify({ produtoIds: [produtoId] }),
        headers: { "content-type": "application/json" },
      }),
    onSuccess: (res) => {
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
    mutationFn: (produtoId: string) =>
      fetchJSON<{ atualizados: number; erros: string[] }>("/api/amazon/sync-buybox", {
        method: "POST",
        body: JSON.stringify({ produtoIds: [produtoId] }),
        headers: { "content-type": "application/json" },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["estoque-produtos"] });
      if (res.erros.length) {
        toast.warning(`Buybox com erros: ${res.erros[0]}`);
      } else {
        toast.success("Status do buybox atualizado");
      }
    },
    onError: () => toast.error("Erro ao buscar buybox"),
  });

  const filtrosStatus: { label: string; value: FiltroStatus }[] = [
    { label: "Todos", value: "TODOS" },
    { label: "Repor", value: "REPOR" },
    { label: "Atenção", value: "ATENCAO" },
    { label: "OK", value: "OK" },
  ];

  return (
    <TooltipProvider delayDuration={400}>
      <>
        <div className="space-y-4">
          {/* Alerta custo ausente */}
          {!isLoading && semCusto > 0 && (
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-800/50 dark:bg-amber-900/20">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span className="text-amber-800 dark:text-amber-200">
                <strong>{semCusto} produto(s)</strong> sem custo unitário — preencha para calcular margem corretamente.
              </span>
            </div>
          )}

          {/* Filtros */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por SKU, nome ou ASIN…"
                  className="pl-8 w-72"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                title="Exportar CSV"
                onClick={() => exportarCSV(produtos, velocidadePorId)}
              >
                <Download className="h-4 w-4" />
              </Button>
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
                <DataTableSkeleton rows={6} columns={9} />
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
                    <TableHead className="w-[130px]">ASIN</TableHead>
                    <TableHead className="w-[90px] text-right">Estoque</TableHead>
                    <TableHead className="hidden w-[170px] lg:table-cell">Amazon FBA</TableHead>
                    <TableHead className="w-[80px] text-right">Mín.</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="hidden w-[80px] text-right xl:table-cell">Dias estq.</TableHead>
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
                        <div className="flex items-center gap-2">
                          {/* B1: thumbnail se tiver imagem */}
                          {(p.amazonImagemUrl || p.amazonCatalogSyncEm) && (
                            <ProdutoThumbnail
                              src={p.amazonImagemUrl}
                              alt={p.nome}
                              title={p.amazonTituloOficial}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium">{p.nome}</div>
                            {p.amazonTituloOficial && p.amazonTituloOficial !== p.nome && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {p.amazonTituloOficial}
                              </div>
                            )}
                            {!p.amazonTituloOficial && p.descricao && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {p.descricao}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            {p.asin ?? "—"}
                          </span>
                          {/* B2: buybox icon */}
                          {p.asin && (
                            <BuyboxPopover
                              produto={p}
                              onSyncBuybox={(id) => syncBuybox.mutate(id)}
                              isSyncing={syncBuybox.isPending && syncBuybox.variables === p.id}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {p.estoqueAtual} {p.unidade}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-muted-foreground">Disp.</span>
                          <span className="text-right font-mono">
                            {p.amazonEstoqueDisponivel ?? "-"}
                          </span>
                          <span className="text-muted-foreground">Res.</span>
                          <span className="text-right font-mono">
                            {p.amazonEstoqueReservado ?? "-"}
                          </span>
                          <span className="text-muted-foreground">Inbound</span>
                          <span className="text-right font-mono">
                            {p.amazonEstoqueInbound ?? "-"}
                          </span>
                          <span className="text-muted-foreground">Total</span>
                          <span className="text-right font-mono">
                            {p.amazonEstoqueTotal ?? "-"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {p.estoqueMinimo}
                      </TableCell>
                      <TableCell>
                        <BadgeReposicao status={p.statusReposicao} />
                      </TableCell>
                      <TableCell className="hidden text-right xl:table-cell">
                        <DiasEstoqueCell vel={velocidadePorId.get(p.id)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <CustoUnitarioInput
                          produtoId={p.id}
                          custoUnitario={p.custoUnitario}
                          disabled={atualizarCusto.isPending}
                          onSalvar={(produtoId, custoUnitario) =>
                            atualizarCusto.mutate({ id: produtoId, custoUnitario })
                          }
                        />
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
                            {p.asin && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => syncCatalog.mutate(p.id)}
                                  disabled={syncCatalog.isPending}
                                >
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                  Buscar catálogo Amazon
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => syncBuybox.mutate(p.id)}
                                  disabled={syncBuybox.isPending}
                                >
                                  <ShoppingCart className="mr-2 h-4 w-4" />
                                  Atualizar buybox
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
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
    </TooltipProvider>
  );
}

function DiasEstoqueCell({ vel }: { vel: VelocidadeProduto | undefined }) {
  if (!vel || vel.criticidade === "SEM_VENDAS") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const dias = vel.diasEstoque;
  if (dias == null) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <span
      className={cn(
        "text-xs font-semibold tabular-nums",
        vel.criticidade === "CRITICO"
          ? "text-red-600 dark:text-red-400"
          : vel.criticidade === "ATENCAO"
            ? "text-amber-600 dark:text-amber-400"
            : "text-emerald-600 dark:text-emerald-400",
      )}
      title={`${vel.unidadesPorDia} un/dia (últimos 30d)`}
    >
      {dias}d
    </span>
  );
}

function CustoUnitarioInput({
  produtoId,
  custoUnitario,
  disabled,
  onSalvar,
}: {
  produtoId: string;
  custoUnitario: number | null;
  disabled?: boolean;
  onSalvar: (produtoId: string, custoUnitario: number | null) => void;
}) {
  const [valor, setValor] = useState(centavosParaInput(custoUnitario));

  useEffect(() => {
    setValor(centavosParaInput(custoUnitario));
  }, [custoUnitario]);

  function salvar() {
    const proximo = inputParaCentavos(valor);
    if (proximo === custoUnitario) return;
    onSalvar(produtoId, proximo);
  }

  return (
    <Input
      type="number"
      min="0"
      step="0.01"
      value={valor}
      disabled={disabled}
      onChange={(e) => setValor(e.target.value)}
      onBlur={salvar}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className="ml-auto h-8 w-[104px] text-right font-mono text-xs tabular-nums"
      aria-label="Custo unitario"
      placeholder="0,00"
    />
  );
}

function centavosParaInput(value: number | null): string {
  if (!value || value <= 0) return "";
  return (value / 100).toFixed(2);
}

function inputParaCentavos(value: string): number | null {
  const normalizado = value.trim().replace(",", ".");
  if (!normalizado) return null;
  const numero = Number(normalizado);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
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
