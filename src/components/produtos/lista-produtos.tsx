"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  Search,
  Pencil,
  PowerOff,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShoppingCart,
  ImageOff,
  Copy,
  PackageSearch,
  Sparkles,
  ArrowUpCircle,
  ArrowDownCircle,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { resolverImagemProduto } from "@/lib/amazon-images";
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
  imagemUrl: string | null;
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

type ResumoTabelaItem = {
  id: string;
  sku: string;
  vendido30d: number;
  buyboxPercent: number | null;
  reembolsoPercent: number;
  sessions30d: number;
  pageViews30d: number;
  trafficUnitsOrdered30d: number;
  trafficRevenueOrderedCentavos: number;
  trafficConversionPercent: number | null;
  trafficBuyBoxPercent: number | null;
};

type ListingDiffField = {
  campo: "titulo" | "preco" | "status" | "imagem";
  erp: string | number | null;
  amazon: string | number | null;
  igual: boolean;
};

type ListingDiffResponse = {
  produto: {
    id: string;
    sku: string;
    nome: string;
  };
  amazon: {
    sellerId: string;
    sku: string;
    asin: string | null;
    titulo: string | null;
    precoCentavos: number | null;
    status: string | null;
    imagemUrl: string | null;
    issuesCount: number;
  };
  diffs: ListingDiffField[];
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

// ── Thumbnail do produto (48px com shadow leve) ─────────────────────────────

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
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-muted shadow-sm">
        <ImageOff className="h-4 w-4 text-muted-foreground/60" />
      </span>
    );
  }

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setErro(true)}
      // Detecta o pixel-placeholder (1x1 transparente) que a Amazon serve quando
      // o produto nao esta indexado naquele CDN publico.
      onLoad={(e) => {
        const w = (e.currentTarget as HTMLImageElement).naturalWidth;
        if (w > 0 && w < 50) setErro(true);
      }}
      className="h-12 w-12 shrink-0 rounded-md border object-contain bg-white shadow-sm"
    />
  );

  if (!title) return img;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{img}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[280px] text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

// ── ASIN com botao de copia ──────────────────────────────────────────────────

function AsinCell({ asin }: { asin: string | null }) {
  if (!asin) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(asin);
        toast.success(`ASIN ${asin} copiado`);
      }}
      className="group inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
      title={`Copiar ${asin}`}
    >
      {asin}
      <Copy className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
    </button>
  );
}

type FiltroAtivo = "ATIVOS" | "INATIVOS" | "TODOS";
type FiltroCusto = "COM_CUSTO" | "SEM_CUSTO" | "TODOS";

function SortableHeader({
  label,
  sortKey,
  sort,
  onToggle,
  align,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onToggle: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const ativo = sort?.key === sortKey;
  const Icon = ativo ? (sort?.dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={cn(
        "group inline-flex items-center gap-1 hover:text-foreground transition-colors",
        align === "right" ? "ml-auto" : "",
        ativo ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      <Icon
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          ativo ? "opacity-100" : "opacity-40 group-hover:opacity-80",
        )}
      />
    </button>
  );
}

type SortKey =
  | "nome"
  | "sku"
  | "estoqueAtual"
  | "estoqueMinimo"
  | "amazonEstoqueTotal"
  | "diasEstoque"
  | "vendido30d"
  | "sessions30d"
  | "trafficConversionPercent"
  | "buyboxPercent"
  | "reembolsoPercent"
  | "custoUnitario";

type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

export function ListaProdutos() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("TODOS");
  const [filtroAtivo, setFiltroAtivo] = useState<FiltroAtivo>("ATIVOS");
  // Default "COM_CUSTO" oculta SKUs descontinuados sem custo unitário (limpa o visual).
  const [filtroCusto, setFiltroCusto] = useState<FiltroCusto>("COM_CUSTO");
  const [sort, setSort] = useState<SortState>(null);

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
  const [listingDiff, setListingDiff] = useState<ListingDiffResponse | null>(null);

  const params = new URLSearchParams();
  if (buscaDebounced) params.set("busca", buscaDebounced);
  if (filtroStatus !== "TODOS") params.set("statusReposicao", filtroStatus);
  // Filtro Ativo/Inativo/Todos — controla parametro `ativo` enviado ao backend.
  if (filtroAtivo === "ATIVOS") params.set("ativo", "true");
  else if (filtroAtivo === "INATIVOS") params.set("ativo", "false");
  // (filtroAtivo === "TODOS" => não envia, backend devolve todos)
  // Filtro Custo: oculta os SKUs descontinuados sem custo por padrão.
  if (filtroCusto === "COM_CUSTO") params.set("temCusto", "true");
  else if (filtroCusto === "SEM_CUSTO") params.set("temCusto", "false");
  const qs = params.toString();

  const { data: produtos = [], isLoading } = useQuery<Produto[]>({
    queryKey: ["estoque-produtos", buscaDebounced, filtroStatus, filtroAtivo, filtroCusto],
    queryFn: () =>
      fetchJSON<Produto[]>(`/api/estoque/produtos${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
  });

  const { data: velocidades = [] } = useQuery<VelocidadeProduto[]>({
    queryKey: ["estoque-velocidade"],
    queryFn: () => fetchJSON<VelocidadeProduto[]>("/api/estoque/velocidade"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: resumoTabela = [] } = useQuery<ResumoTabelaItem[]>({
    queryKey: ["produtos-resumo-tabela"],
    queryFn: () => fetchJSON<ResumoTabelaItem[]>("/api/produtos/resumo-tabela"),
    staleTime: 5 * 60 * 1000,
  });

  const velocidadePorId = useMemo(
    () => new Map(velocidades.map((v) => [v.produtoId, v])),
    [velocidades],
  );
  const resumoPorId = useMemo(
    () => new Map(resumoTabela.map((r) => [r.id, r])),
    [resumoTabela],
  );

  // Ordenacao client-side. Cada coluna sortavel chama toggleSort com sua chave.
  const produtosOrdenados = useMemo(() => {
    if (!sort) return produtos;
    const arr = [...produtos];
    const dir = sort.dir === "asc" ? 1 : -1;
    const valorDe = (p: Produto): number | string | null => {
      switch (sort.key) {
        case "nome":
          return p.nome.toLowerCase();
        case "sku":
          return p.sku.toLowerCase();
        case "estoqueAtual":
          return p.estoqueAtual ?? 0;
        case "estoqueMinimo":
          return p.estoqueMinimo ?? 0;
        case "amazonEstoqueTotal":
          return p.amazonEstoqueTotal ?? 0;
        case "diasEstoque":
          return velocidadePorId.get(p.id)?.diasEstoque ?? -1;
        case "vendido30d":
          return (
            resumoPorId.get(p.id)?.vendido30d ??
            velocidadePorId.get(p.id)?.vendido30d ??
            0
          );
        case "sessions30d":
          return resumoPorId.get(p.id)?.sessions30d ?? 0;
        case "trafficConversionPercent":
          return resumoPorId.get(p.id)?.trafficConversionPercent ?? -1;
        case "buyboxPercent":
          return resumoPorId.get(p.id)?.buyboxPercent ?? -1;
        case "reembolsoPercent":
          return resumoPorId.get(p.id)?.reembolsoPercent ?? -1;
        case "custoUnitario":
          return p.custoUnitario ?? 0;
      }
    };
    arr.sort((a, b) => {
      const va = valorDe(a);
      const vb = valorDe(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }, [produtos, sort, velocidadePorId, resumoPorId]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // ciclo: asc -> desc -> sem ordenacao
    });
  };

  const semCusto = produtos.filter((p) => !p.custoUnitario).length;

  // Chip de contagem
  const contadores = useMemo(() => {
    const total = produtos.length;
    const comVendas30d = produtos.filter((p) => {
      const v = resumoPorId.get(p.id)?.vendido30d ?? velocidadePorId.get(p.id)?.vendido30d ?? 0;
      return v > 0;
    }).length;
    const alertaRepor = produtos.filter((p) => p.statusReposicao === "REPOR").length;
    return { total, comVendas30d, alertaRepor };
  }, [produtos, resumoPorId, velocidadePorId]);

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

  const verificarListing = useMutation({
    mutationFn: (produtoId: string) =>
      fetchJSON<ListingDiffResponse>(
        `/api/produtos/${produtoId}/amazon-listing-diff`,
      ),
    onSuccess: (res) => {
      setListingDiff(res);
      const divergencias = res.diffs.filter((d) => !d.igual).length;
      if (divergencias > 0) {
        toast.warning(`${divergencias} divergencia(s) encontradas no listing`);
      } else {
        toast.success("Listing Amazon confere com o ERP");
      }
    },
    onError: (err) =>
      toast.error((err as Error).message ?? "Erro ao verificar listing"),
  });

  const syncTudo = useMutation({
    mutationFn: () =>
      fetchJSON("/api/amazon/sync", {
        method: "POST",
        body: JSON.stringify({ tipo: "ALL" }),
        headers: { "content-type": "application/json" },
      }),
    onSuccess: () => {
      toast.success("Sincronização enfileirada (catálogo, buybox e estoque)");
    },
    onError: (err) =>
      toast.error((err as Error).message ?? "Erro ao enfileirar sincronização"),
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

          {/* Toolbar superior — chips de contagem + sync tudo */}
          <div className="flex flex-col gap-2 rounded-lg border bg-card/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium tabular-nums">
                <PackageSearch className="h-3.5 w-3.5 text-muted-foreground" />
                {contadores.total} produtos
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium tabular-nums",
                  contadores.comVendas30d > 0
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {contadores.comVendas30d} com vendas 30d
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium tabular-nums",
                  contadores.alertaRepor > 0
                    ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {contadores.alertaRepor > 0 && <AlertTriangle className="h-3 w-3" />}
                {contadores.alertaRepor} alertas REPOR
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              disabled={syncTudo.isPending}
              onClick={() => syncTudo.mutate()}
            >
              <Sparkles className={cn("h-3.5 w-3.5", syncTudo.isPending && "animate-pulse")} />
              {syncTudo.isPending ? "Enfileirando…" : "Sincronizar tudo"}
            </Button>
          </div>

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
            <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
              {(["ATIVOS", "INATIVOS", "TODOS"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFiltroAtivo(v)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    filtroAtivo === v
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "ATIVOS" ? "Ativos" : v === "INATIVOS" ? "Inativos" : "Todos"}
                </button>
              ))}
            </div>
            <div
              className="flex gap-1 rounded-lg border bg-muted/30 p-1"
              title="Oculta SKUs sem custo unitário cadastrado (descontinuados)"
            >
              {(["COM_CUSTO", "SEM_CUSTO", "TODOS"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFiltroCusto(v)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    filtroCusto === v
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "COM_CUSTO" ? "Com custo" : v === "SEM_CUSTO" ? "Sem custo" : "Todos"}
                </button>
              ))}
            </div>
          </div>

          {/* Tabela */}
          <div className="overflow-hidden rounded-xl border bg-card">
            {isLoading ? (
              <div className="p-4">
                <DataTableSkeleton rows={6} columns={14} />
              </div>
            ) : produtos.length === 0 ? (
              <EmptyState busca={busca} filtroStatus={filtroStatus} />
            ) : (
              <div className="max-h-[calc(100vh-22rem)] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-3 py-3 w-[260px]">
                        <SortableHeader label="Produto" sortKey="nome" sort={sort} onToggle={toggleSort} />
                      </TableHead>
                      <TableHead className="px-3 py-3 w-[120px]">
                        <SortableHeader label="SKU" sortKey="sku" sort={sort} onToggle={toggleSort} />
                      </TableHead>
                      <TableHead className="px-3 py-3 w-[130px]">ASIN</TableHead>
                      <TableHead className="px-3 py-3 w-[90px] text-right">
                        <SortableHeader label="Estoque" sortKey="estoqueAtual" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="hidden px-3 py-3 w-[170px] lg:table-cell">
                        <SortableHeader label="Amazon FBA" sortKey="amazonEstoqueTotal" sort={sort} onToggle={toggleSort} />
                      </TableHead>
                      <TableHead className="px-3 py-3 w-[80px] text-right">
                        <SortableHeader label="Mín." sortKey="estoqueMinimo" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="px-3 py-3 w-[100px]">Status</TableHead>
                      <TableHead className="hidden px-3 py-3 w-[80px] text-right xl:table-cell">
                        <SortableHeader label="Dias estq." sortKey="diasEstoque" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="hidden px-3 py-3 w-[90px] text-right xl:table-cell">
                        <SortableHeader label="Vendas 30d" sortKey="vendido30d" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="hidden px-3 py-3 w-[110px] text-right 2xl:table-cell">
                        <SortableHeader label="Sessoes" sortKey="sessions30d" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="hidden px-3 py-3 w-[90px] text-right 2xl:table-cell">
                        <SortableHeader label="Conv." sortKey="trafficConversionPercent" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="hidden px-3 py-3 w-[110px] xl:table-cell">
                        <SortableHeader label="Buybox" sortKey="buyboxPercent" sort={sort} onToggle={toggleSort} />
                      </TableHead>
                      <TableHead className="hidden px-3 py-3 w-[90px] text-right xl:table-cell">
                        <SortableHeader label="Reembolso" sortKey="reembolsoPercent" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="px-3 py-3 w-[110px] text-right">
                        <SortableHeader label="Custo unit." sortKey="custoUnitario" sort={sort} onToggle={toggleSort} align="right" />
                      </TableHead>
                      <TableHead className="px-3 py-3 w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosOrdenados.map((p) => (
                      <TableRow
                        key={p.id}
                        className="border-b transition-colors even:bg-muted/10 hover:bg-muted/30"
                      >
                        <TableCell className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <ProdutoThumbnail
                              src={
                                p.imagemUrl
                                  ? `/api/produtos/${p.id}/imagem`
                                  : resolverImagemProduto(p.amazonImagemUrl, p.asin)
                              }
                              alt={p.nome}
                              title={p.amazonTituloOficial}
                            />
                            <div className="min-w-0 max-w-[200px]">
                              <div
                                className="font-semibold leading-tight line-clamp-2"
                                title={p.nome}
                              >
                                {p.nome}
                              </div>
                              {p.amazonTituloOficial && p.amazonTituloOficial !== p.nome && (
                                <div
                                  className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1"
                                  title={p.amazonTituloOficial}
                                >
                                  {p.amazonTituloOficial}
                                </div>
                              )}
                              {!p.amazonTituloOficial && p.descricao && (
                                <div
                                  className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1"
                                  title={p.descricao}
                                >
                                  {p.descricao}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs font-medium">
                            {p.sku}
                          </span>
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <AsinCell asin={p.asin} />
                            {p.asin && (
                              <BuyboxPopover
                                produto={p}
                                onSyncBuybox={(id) => syncBuybox.mutate(id)}
                                isSyncing={syncBuybox.isPending && syncBuybox.variables === p.id}
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3 text-right font-mono font-semibold tabular-nums">
                          {p.estoqueAtual} <span className="text-xs text-muted-foreground">{p.unidade}</span>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 lg:table-cell">
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
                        <TableCell className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {p.estoqueMinimo}
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <BadgeReposicao status={p.statusReposicao} />
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 text-right xl:table-cell">
                          <DiasEstoqueCell vel={velocidadePorId.get(p.id)} />
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 text-right xl:table-cell">
                          <Vendas30dBadge
                            valor={
                              resumoPorId.get(p.id)?.vendido30d ??
                              velocidadePorId.get(p.id)?.vendido30d ??
                              0
                            }
                          />
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 text-right 2xl:table-cell">
                          <TrafficSessionsCell resumo={resumoPorId.get(p.id)} />
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 text-right 2xl:table-cell">
                          <TrafficConversionCell percent={resumoPorId.get(p.id)?.trafficConversionPercent ?? null} />
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 xl:table-cell">
                          <BuyboxBar percent={resumoPorId.get(p.id)?.buyboxPercent ?? null} />
                        </TableCell>
                        <TableCell className="hidden px-3 py-3 text-right xl:table-cell">
                          <ReembolsoPercentCell percent={resumoPorId.get(p.id)?.reembolsoPercent ?? 0} />
                        </TableCell>
                        <TableCell className="px-3 py-3 text-right">
                          <CustoUnitarioInput
                            produtoId={p.id}
                            custoUnitario={p.custoUnitario}
                            disabled={atualizarCusto.isPending}
                            onSalvar={(produtoId, custoUnitario) =>
                              atualizarCusto.mutate({ id: produtoId, custoUnitario })
                            }
                          />
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/produtos/${p.id}`}>
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
                                  <DropdownMenuItem
                                    onClick={() => verificarListing.mutate(p.id)}
                                    disabled={verificarListing.isPending}
                                  >
                                    <PackageSearch className="mr-2 h-4 w-4" />
                                    Verificar listing Amazon
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
              </div>
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

        <ListingDiffDialog
          diff={listingDiff}
          open={listingDiff !== null}
          onOpenChange={(open) => {
            if (!open) setListingDiff(null);
          }}
        />
      </>
    </TooltipProvider>
  );
}

function ListingDiffDialog({
  diff,
  open,
  onOpenChange,
}: {
  diff: ListingDiffResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!diff) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Listing Amazon</DialogTitle>
          <DialogDescription>
            {diff.produto.sku} · Seller {diff.amazon.sellerId}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">ASIN</div>
            <div className="mt-1 font-mono text-sm">{diff.amazon.asin ?? "-"}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="mt-1 text-sm font-medium">{diff.amazon.status ?? "-"}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Issues</div>
            <div className="mt-1 text-sm font-medium">{diff.amazon.issuesCount}</div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campo</TableHead>
              <TableHead>ERP</TableHead>
              <TableHead>Amazon</TableHead>
              <TableHead className="text-right">Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {diff.diffs.map((item) => (
              <TableRow key={item.campo}>
                <TableCell className="capitalize">{item.campo}</TableCell>
                <TableCell className="max-w-[220px] truncate">
                  {formatListingValue(item.campo, item.erp)}
                </TableCell>
                <TableCell className="max-w-[260px] truncate">
                  {formatListingValue(item.campo, item.amazon)}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                      item.igual
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
                    )}
                  >
                    {item.igual ? "OK" : "Divergente"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

function formatListingValue(
  campo: ListingDiffField["campo"],
  value: string | number | null,
) {
  if (value == null || value === "") return "-";
  if (campo === "preco" && typeof value === "number") return formatBRL(value);
  return String(value);
}

// ── Empty state amigavel ─────────────────────────────────────────────────────

function EmptyState({
  busca,
  filtroStatus,
}: {
  busca: string;
  filtroStatus: FiltroStatus;
}) {
  const filtrado = busca || filtroStatus !== "TODOS";
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center text-muted-foreground">
      <PackageSearch className="mb-4 h-12 w-12 opacity-30" />
      <p className="text-base font-medium text-foreground">
        Nenhum produto encontrado
      </p>
      <p className="mt-1 max-w-sm text-sm">
        {busca
          ? `Sem resultados para “${busca}”. Tente buscar por SKU, nome ou ASIN.`
          : filtroStatus !== "TODOS"
            ? "Nenhum produto com esse status. Limpe o filtro ou crie um novo produto."
            : "Comece criando seu primeiro produto com um SKU no formato MFS-XXXX."}
      </p>
      {filtrado && (
        <p className="mt-3 text-xs text-muted-foreground/70">
          Lembre-se: SKUs precisam começar com{" "}
          <code className="rounded bg-muted px-1 font-mono">MFS-</code> para aparecer aqui.
        </p>
      )}
    </div>
  );
}

// ── Vendas 30d badge ─────────────────────────────────────────────────────────

function Vendas30dBadge({ valor }: { valor: number }) {
  if (valor === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (valor > 10) {
    return (
      <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums dark:bg-emerald-900/30 dark:text-emerald-300">
        {valor}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums">
      {valor}
    </span>
  );
}

// ── Buybox bar (mais visual que numero) ──────────────────────────────────────

function TrafficSessionsCell({
  resumo,
}: {
  resumo: ResumoTabelaItem | undefined;
}) {
  const sessions = resumo?.sessions30d ?? 0;
  if (sessions === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div
      className="text-right"
      title={`${resumo?.pageViews30d ?? 0} page views nos ultimos 30 dias`}
    >
      <div className="font-mono text-xs font-semibold tabular-nums">
        {sessions.toLocaleString("pt-BR")}
      </div>
      <div className="text-[10px] text-muted-foreground">
        PV {(resumo?.pageViews30d ?? 0).toLocaleString("pt-BR")}
      </div>
    </div>
  );
}

function TrafficConversionCell({ percent }: { percent: number | null }) {
  if (percent == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const cor =
    percent >= 12
      ? "text-emerald-600 dark:text-emerald-400"
      : percent >= 6
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <span
      className={cn("text-xs font-semibold tabular-nums", cor)}
      title="Conversao de unidades por sessao nos ultimos 30 dias"
    >
      {percent.toFixed(1)}%
    </span>
  );
}

function BuyboxBar({ percent }: { percent: number | null }) {
  if (percent == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const pct = Math.max(0, Math.min(100, percent));
  const cor =
    pct >= 80
      ? "bg-emerald-500"
      : pct >= 40
        ? "bg-amber-500"
        : "bg-red-500";
  const corTxt =
    pct >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div
      className="flex flex-col gap-1"
      title={`Buybox: ${pct.toFixed(0)}% nos ultimos 15 dias`}
    >
      <div className={cn("text-[11px] font-semibold tabular-nums", corTxt)}>
        {pct.toFixed(0)}%
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", cor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ReembolsoPercentCell({ percent }: { percent: number }) {
  if (percent === 0) {
    return (
      <span className="inline-flex items-center justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums dark:bg-emerald-900/20 dark:text-emerald-400">
        0%
      </span>
    );
  }
  const cor =
    percent > 7
      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
      : percent >= 3
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        cor,
      )}
      title="Taxa de reembolso (últimos 30 dias)"
    >
      {percent.toFixed(1)}%
    </span>
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
