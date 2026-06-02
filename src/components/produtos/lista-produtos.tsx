"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownCircle,
  ArrowUp,
  ArrowUpCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  Filter,
  History,
  ImageOff,
  MoreHorizontal,
  Package,
  PackageSearch,
  Pencil,
  PowerOff,
  RefreshCw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarginBadge } from "@/components/ui/margin-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DialogCustoHistorico } from "./dialog-custo-historico";
import { DialogMovimentacaoEstoque } from "./dialog-movimentacao-estoque";
import { DialogProduto } from "./dialog-produto";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { resolverImagemProduto } from "@/lib/amazon-images";
import { cn } from "@/lib/utils";
import { StatusReposicao } from "@/modules/shared/domain";
import {
  DEFAULT_PRODUTO_FILTROS,
  EstoqueFiltroOperacional,
  produtoFiltrosToSearchParams,
  type ProdutoFiltrosQuery,
} from "@/modules/estoque/filtros";

type Produto = {
  id: string;
  sku: string;
  asin: string | null;
  nome: string;
  descricao: string | null;
  custoUnitario: number | null;
  precoVenda: number | null;
  amazonPrecoListagemCentavos: number | null;
  amazonPrecoListagemSyncEm: string | null;
  estoqueAtual: number;
  amazonEstoqueDisponivel: number | null;
  amazonEstoqueReservado: number | null;
  amazonEstoqueInbound: number | null;
  amazonEstoqueTotal: number | null;
  amazonUltimaSyncEm: string | null;
  amazonImagemUrl: string | null;
  amazonTituloOficial: string | null;
  amazonCategoria: string | null;
  amazonCategoriaFee: string | null;
  amazonCatalogSyncEm: string | null;
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
  adsGastoCentavos30d: number;
  adsVendasCentavos30d: number;
  adsAcosPercent30d: number | null;
  adsImpressoes30d: number;
  adsCliques30d: number;
};

type ResumoTabelaCobertura = {
  totalProdutos: number;
  trafficRows: number;
  skusComTraffic: number;
  buyboxSnapshots15d: number;
  skusComBuybox15d: number;
  trafficAtualizadoEm: string | null;
};

type ResumoTabelaResponse =
  | ResumoTabelaItem[]
  | {
      itens: ResumoTabelaItem[];
      cobertura: ResumoTabelaCobertura;
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

type SortKey =
  | "nome"
  | "sku"
  | "precoAmazon"
  | "estoqueVendavel"
  | "custoUnitario"
  | "margem"
  | "vendido30d"
  | "ultimaSync"
  | "status";

type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

type ColumnKey =
  | "sku"
  | "asin"
  | "precoAmazon"
  | "estoque"
  | "custo"
  | "margem"
  | "vendas30d"
  | "ultimaSync"
  | "status"
  | "traffic"
  | "conversion"
  | "buybox";

type ListaProdutosProps = {
  filtros: ProdutoFiltrosQuery;
  filtrosConsulta: ProdutoFiltrosQuery;
  onFiltrosChange: Dispatch<SetStateAction<ProdutoFiltrosQuery>>;
};

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = {
  sku: true,
  asin: true,
  precoAmazon: true,
  estoque: true,
  custo: true,
  margem: true,
  vendas30d: true,
  ultimaSync: true,
  status: true,
  traffic: false,
  conversion: false,
  buybox: false,
};

const PAGE_SIZE_OPTIONS = [5, 10, 25, 50];

function normalizeResumoResponse(data: ResumoTabelaResponse | undefined) {
  if (!data) {
    return {
      itens: [] as ResumoTabelaItem[],
      cobertura: {
        totalProdutos: 0,
        trafficRows: 0,
        skusComTraffic: 0,
        buyboxSnapshots15d: 0,
        skusComBuybox15d: 0,
        trafficAtualizadoEm: null,
      } satisfies ResumoTabelaCobertura,
    };
  }

  if (Array.isArray(data)) {
    return {
      itens: data,
      cobertura: {
        totalProdutos: data.length,
        trafficRows: data.filter((r) => r.sessions30d > 0 || r.pageViews30d > 0).length,
        skusComTraffic: data.filter(
          (r) =>
            r.sessions30d > 0 ||
            r.pageViews30d > 0 ||
            r.trafficUnitsOrdered30d > 0,
        ).length,
        buyboxSnapshots15d: data.filter((r) => r.buyboxPercent != null).length,
        skusComBuybox15d: data.filter((r) => r.buyboxPercent != null).length,
        trafficAtualizadoEm: null,
      },
    };
  }

  return data;
}

function valorPositivo(valor: number | null | undefined) {
  return valor != null && valor > 0 ? valor : null;
}

function getPrecoAmazon(produto: Produto) {
  return valorPositivo(produto.amazonPrecoListagemCentavos);
}

function getCusto(produto: Produto) {
  return valorPositivo(produto.custoUnitario);
}

function getEstoqueVendavel(produto: Produto) {
  if (produto.amazonEstoqueDisponivel != null) {
    return Math.max(0, produto.amazonEstoqueDisponivel);
  }
  return Math.max(0, produto.estoqueAtual);
}

function getMargemPercent(produto: Produto) {
  const preco = getPrecoAmazon(produto);
  const custo = getCusto(produto);
  if (!preco || !custo) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}

function getUltimaSync(produto: Produto) {
  return (
    produto.amazonPrecoListagemSyncEm ??
    produto.amazonUltimaSyncEm ??
    produto.amazonCatalogSyncEm ??
    produto.buyboxUltimaSyncEm
  );
}

function formatDataHoraCurta(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatNumero(valor: number) {
  return valor.toLocaleString("pt-BR");
}

function formatPercent(valor: number | null) {
  if (valor == null || !Number.isFinite(valor)) return "-";
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function exportarCSV(
  produtos: Produto[],
  resumoPorId: Map<string, ResumoTabelaItem>,
) {
  const linhas = [
    [
      "SKU",
      "Nome",
      "ASIN",
      "Preço Amazon (R$)",
      "Estoque vendável",
      "Custo unit. (R$)",
      "Margem (%)",
      "Vendas 30d",
      "Última sync",
      "Status",
    ],
    ...produtos.map((p) => {
      const resumo = resumoPorId.get(p.id);
      const preco = getPrecoAmazon(p);
      const custo = getCusto(p);
      const margem = getMargemPercent(p);
      return [
        p.sku,
        p.nome,
        p.asin ?? "",
        preco ? (preco / 100).toFixed(2) : "",
        String(getEstoqueVendavel(p)),
        custo ? (custo / 100).toFixed(2) : "",
        margem != null ? String(margem).replace(".", ",") : "",
        String(resumo?.vendido30d ?? 0),
        formatDataHoraCurta(getUltimaSync(p)),
        p.ativo ? p.statusReposicao : "INATIVO",
      ];
    }),
  ];

  const csv = linhas
    .map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `produtos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/60 shadow-sm">
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
      onLoad={(e) => {
        const w = (e.currentTarget as HTMLImageElement).naturalWidth;
        if (w > 0 && w < 50) setErro(true);
      }}
      className="h-10 w-10 shrink-0 rounded-md border bg-white object-contain shadow-sm"
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

function AsinCell({ asin }: { asin: string | null }) {
  if (!asin) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(asin);
          toast.success(`ASIN ${asin} copiado`);
        }}
        className="group inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-slate-600 transition hover:bg-muted/70 hover:text-foreground"
        title={`Copiar ${asin}`}
      >
        {asin}
        <Copy className="h-3 w-3 opacity-0 transition group-hover:opacity-70" />
      </button>
      <a
        href={`https://www.amazon.com.br/dp/${asin}`}
        target="_blank"
        rel="noreferrer"
        className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        title="Abrir na Amazon"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

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
        "group inline-flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-normal transition-colors hover:text-foreground",
        align === "right" ? "justify-end" : "justify-start",
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

function StatusBadge({ produto }: { produto: Produto }) {
  if (!produto.ativo) {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
        Inativo
      </span>
    );
  }

  if (produto.statusReposicao === StatusReposicao.REPOR) {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
        Repor
      </span>
    );
  }

  if (produto.statusReposicao === StatusReposicao.ATENCAO) {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        Atenção
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      Ativo
    </span>
  );
}

function EstoqueCell({ produto }: { produto: Produto }) {
  const estoque = getEstoqueVendavel(produto);
  const semEstoque = estoque <= 0;
  return (
    <div className="text-right">
      <div
        className={cn(
          "font-mono text-xs font-semibold tabular-nums",
          semEstoque ? "text-red-600" : "text-slate-700",
        )}
      >
        {formatNumero(estoque)} {produto.unidade}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[11px]",
          semEstoque ? "font-semibold text-red-600" : "text-muted-foreground",
        )}
      >
        {semEstoque ? "Sem estoque" : "Disponível"}
      </div>
    </div>
  );
}

function SyncCell({ produto }: { produto: Produto }) {
  const sync = getUltimaSync(produto);
  if (!sync) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        Sem sync
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      {formatDataHoraCurta(sync)}
    </span>
  );
}

function PriceCell({ produto }: { produto: Produto }) {
  const preco = getPrecoAmazon(produto);
  if (!preco) {
    return (
      <div className="text-right">
        <div className="text-xs font-semibold text-red-600">Sem preço</div>
        <div className="text-[11px] text-muted-foreground">Amazon</div>
      </div>
    );
  }

  return (
    <div className="text-right">
      <div className="font-mono text-xs font-semibold tabular-nums">
        {formatBRL(preco)}
      </div>
      <div className="text-[11px] text-muted-foreground">SP-API</div>
    </div>
  );
}

function CoverageHint({ cobertura }: { cobertura: ResumoTabelaCobertura }) {
  const semTraffic = cobertura.skusComTraffic === 0;
  const semBuybox = cobertura.skusComBuybox15d === 0;
  if (!semTraffic && !semBuybox) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      {semTraffic && <span>Métricas de tráfego ocultas: sem dados recentes por SKU.</span>}
      {semBuybox && <span>Buybox histórico oculto: sem snapshots nos últimos 15 dias.</span>}
    </div>
  );
}

function ColumnToggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
        disabled ? "bg-muted/40 text-muted-foreground" : "bg-background",
      )}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

function EmptyState({
  busca,
  filtros,
  onLimpar,
}: {
  busca: string;
  filtros: ProdutoFiltrosQuery;
  onLimpar: () => void;
}) {
  const filtrado =
    busca ||
    filtros.estoque !== DEFAULT_PRODUTO_FILTROS.estoque ||
    filtros.ativo !== DEFAULT_PRODUTO_FILTROS.ativo ||
    filtros.statusReposicao ||
    filtros.semCusto ||
    filtros.semSyncAmazon;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center text-muted-foreground">
      <PackageSearch className="mb-4 h-12 w-12 opacity-30" />
      <p className="text-base font-semibold text-foreground">Nenhum produto encontrado</p>
      <p className="mt-1 max-w-sm text-sm">
        {busca
          ? `Sem resultados para "${busca}". Tente buscar por SKU, nome ou ASIN.`
          : filtrado
            ? "Nenhum produto nessa visão. Ajuste os filtros ou limpe a busca."
            : "Comece criando seu primeiro produto com um SKU no formato MFS-XXXX."}
      </p>
      {filtrado && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onLimpar}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}

export function ListaProdutos({
  filtros,
  filtrosConsulta,
  onFiltrosChange,
}: ListaProdutosProps) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visao, setVisao] = useState<"todos" | "comEstoque" | "alertas">("todos");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [filtrosAberto, setFiltrosAberto] = useState(false);
  const [custoMin, setCustoMin] = useState("");
  const [custoMax, setCustoMax] = useState("");
  const [margemMin, setMargemMin] = useState("");
  const [margemMax, setMargemMax] = useState("");
  const [vendasMin, setVendasMin] = useState("");
  const [vendasMax, setVendasMax] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogProduto, setDialogProduto] = useState<{
    aberto: boolean;
    produto: Produto | null;
  }>({ aberto: false, produto: null });
  const [dialogMov, setDialogMov] = useState<{
    aberto: boolean;
    produtoId: string;
    nome: string;
  }>({ aberto: false, produtoId: "", nome: "" });
  const [dialogCusto, setDialogCusto] = useState<{
    aberto: boolean;
    produtoId: string | null;
  }>({ aberto: false, produtoId: null });
  const [listingDiff, setListingDiff] = useState<ListingDiffResponse | null>(null);

  const qs = produtoFiltrosToSearchParams(filtrosConsulta).toString();
  const { data: produtos = [], isLoading } = useQuery<Produto[]>({
    queryKey: ["estoque-produtos", qs],
    queryFn: () =>
      fetchJSON<Produto[]>(`/api/estoque/produtos${qs ? `?${qs}` : ""}`),
    placeholderData: keepPreviousData,
  });

  const { data: velocidades = [] } = useQuery<VelocidadeProduto[]>({
    queryKey: ["estoque-velocidade"],
    queryFn: () => fetchJSON<VelocidadeProduto[]>("/api/estoque/velocidade"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: resumoTabelaRaw } = useQuery<ResumoTabelaResponse>({
    queryKey: ["produtos-resumo-tabela"],
    queryFn: () => fetchJSON<ResumoTabelaResponse>("/api/produtos/resumo-tabela"),
    staleTime: 5 * 60 * 1000,
  });

  const { itens: resumoTabela, cobertura } = useMemo(
    () => normalizeResumoResponse(resumoTabelaRaw),
    [resumoTabelaRaw],
  );

  const velocidadePorId = useMemo(
    () => new Map(velocidades.map((v) => [v.produtoId, v])),
    [velocidades],
  );
  const resumoPorId = useMemo(
    () => new Map(resumoTabela.map((r) => [r.id, r])),
    [resumoTabela],
  );

  const filtrosNumericosAtivos = Boolean(
    custoMin || custoMax || margemMin || margemMax || vendasMin || vendasMax,
  );

  const produtosFiltrados = useMemo(() => {
    const minCusto = parseDecimal(custoMin);
    const maxCusto = parseDecimal(custoMax);
    const minMargem = parseDecimal(margemMin);
    const maxMargem = parseDecimal(margemMax);
    const minVendas = parseInteiro(vendasMin);
    const maxVendas = parseInteiro(vendasMax);

    return produtos.filter((p) => {
      if (visao === "comEstoque" && getEstoqueVendavel(p) <= 0) return false;
      if (
        visao === "alertas" &&
        p.statusReposicao !== StatusReposicao.REPOR &&
        p.statusReposicao !== StatusReposicao.ATENCAO &&
        getEstoqueVendavel(p) > 0 &&
        getPrecoAmazon(p)
      ) {
        return false;
      }

      const custo = getCusto(p);
      const margem = getMargemPercent(p);
      const vendas = resumoPorId.get(p.id)?.vendido30d ?? 0;

      if (minCusto != null && (!custo || custo < minCusto * 100)) return false;
      if (maxCusto != null && (!custo || custo > maxCusto * 100)) return false;
      if (minMargem != null && (margem == null || margem < minMargem)) return false;
      if (maxMargem != null && (margem == null || margem > maxMargem)) return false;
      if (minVendas != null && vendas < minVendas) return false;
      if (maxVendas != null && vendas > maxVendas) return false;

      return true;
    });
  }, [
    custoMax,
    custoMin,
    margemMax,
    margemMin,
    produtos,
    resumoPorId,
    vendasMax,
    vendasMin,
    visao,
  ]);

  const produtosOrdenados = useMemo(() => {
    if (!sort) return produtosFiltrados;
    const arr = [...produtosFiltrados];
    const dir = sort.dir === "asc" ? 1 : -1;
    const valorDe = (p: Produto): number | string => {
      switch (sort.key) {
        case "nome":
          return p.nome.toLowerCase();
        case "sku":
          return p.sku.toLowerCase();
        case "precoAmazon":
          return getPrecoAmazon(p) ?? -1;
        case "estoqueVendavel":
          return getEstoqueVendavel(p);
        case "custoUnitario":
          return getCusto(p) ?? -1;
        case "margem":
          return getMargemPercent(p) ?? -999;
        case "vendido30d":
          return resumoPorId.get(p.id)?.vendido30d ?? 0;
        case "ultimaSync": {
          const sync = getUltimaSync(p);
          return sync ? new Date(sync).getTime() : 0;
        }
        case "status":
          return p.ativo ? p.statusReposicao : "INATIVO";
      }
    };
    arr.sort((a, b) => {
      const va = valorDe(a);
      const vb = valorDe(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.nome.localeCompare(b.nome);
    });
    return arr;
  }, [produtosFiltrados, resumoPorId, sort]);

  const totalPages = Math.max(1, Math.ceil(produtosOrdenados.length / pageSize));
  const paginaAtual = Math.min(page, totalPages);
  const inicio = (paginaAtual - 1) * pageSize;
  const produtosPaginados = produtosOrdenados.slice(inicio, inicio + pageSize);
  const selecionadosNaPagina = produtosPaginados.filter((p) => selected.has(p.id));
  const todosPaginaSelecionados =
    produtosPaginados.length > 0 && selecionadosNaPagina.length === produtosPaginados.length;

  useEffect(() => {
    setPage(1);
  }, [
    custoMax,
    custoMin,
    filtrosConsulta,
    margemMax,
    margemMin,
    pageSize,
    sort,
    vendasMax,
    vendasMin,
    visao,
  ]);

  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(produtos.map((p) => p.id));
      const filtrados = [...prev].filter((id) => ids.has(id));
      if (filtrados.length === prev.size) return prev;
      return new Set(filtrados);
    });
  }, [produtos]);

  const semCusto = produtos.filter((p) => !getCusto(p)).length;
  const semPrecoAmazon = produtos.filter((p) => !getPrecoAmazon(p)).length;
  const alertas = produtos.filter(
    (p) =>
      p.statusReposicao === StatusReposicao.REPOR ||
      p.statusReposicao === StatusReposicao.ATENCAO ||
      getEstoqueVendavel(p) <= 0 ||
      !getPrecoAmazon(p),
  ).length;

  const contadores = useMemo(() => {
    const comEstoque = produtos.filter((p) => getEstoqueVendavel(p) > 0).length;
    return {
      total: produtos.length,
      comEstoque,
      alertas,
    };
  }, [alertas, produtos]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const setBusca = (valor: string) => {
    onFiltrosChange((prev) => ({ ...prev, busca: valor }));
  };

  const limparFiltros = () => {
    onFiltrosChange({ ...DEFAULT_PRODUTO_FILTROS, busca: "" });
    setVisao("todos");
    setCustoMin("");
    setCustoMax("");
    setMargemMin("");
    setMargemMax("");
    setVendasMin("");
    setVendasMax("");
  };

  const filtrosForaPadrao =
    (filtros.busca ?? "") !== "" ||
    filtros.ativo !== DEFAULT_PRODUTO_FILTROS.ativo ||
    filtros.estoque !== DEFAULT_PRODUTO_FILTROS.estoque ||
    filtros.statusReposicao !== DEFAULT_PRODUTO_FILTROS.statusReposicao ||
    !!filtros.semCusto ||
    !!filtros.semSyncAmazon ||
    visao !== "todos" ||
    filtrosNumericosAtivos;

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
      toast.success("Custo unitário atualizado");
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
      qc.invalidateQueries({ queryKey: ["produtos-resumo-tabela"] });
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
        toast.success("Listing Amazon confere com o cache local");
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
      toast.success("Sincronização enfileirada");
    },
    onError: (err) =>
      toast.error((err as Error).message ?? "Erro ao enfileirar sincronização"),
  });

  const busca = filtros.busca ?? "";

  return (
    <TooltipProvider delayDuration={350}>
      <>
        <div className="space-y-3">
          {(semCusto > 0 || semPrecoAmazon > 0) && !isLoading && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              {semCusto > 0 && <span>{semCusto} produto(s) sem custo.</span>}
              {semPrecoAmazon > 0 && (
                <span>{semPrecoAmazon} produto(s) sem preço Amazon sincronizado.</span>
              )}
            </div>
          )}

          <CoverageHint cobertura={cobertura} />

          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <SegmentButton
                  active={visao === "todos"}
                  label="Todos"
                  count={contadores.total}
                  onClick={() => setVisao("todos")}
                />
                <SegmentButton
                  active={visao === "comEstoque"}
                  label="Com estoque"
                  count={contadores.comEstoque}
                  tone="green"
                  onClick={() => setVisao("comEstoque")}
                />
                <SegmentButton
                  active={visao === "alertas"}
                  label="Alertas"
                  count={contadores.alertas}
                  tone="amber"
                  onClick={() => setVisao("alertas")}
                />
                {selected.size > 0 && (
                  <span className="inline-flex h-9 items-center rounded-md bg-blue-50 px-3 text-xs font-semibold text-blue-700">
                    {selected.size} selecionado(s)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  onClick={() => setFiltrosAberto(true)}
                >
                  <Filter className="h-4 w-4" />
                  Filtros
                  {filtrosForaPadrao && (
                    <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                      1
                    </span>
                  )}
                </Button>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 gap-2"
                    >
                      <Columns3 className="h-4 w-4" />
                      Colunas
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-2" align="end">
                    <div>
                      <p className="text-sm font-semibold">Colunas da tabela</p>
                      <p className="text-xs text-muted-foreground">
                        Dados sem cobertura ficam ocultos por padrão.
                      </p>
                    </div>
                    {COLUMN_OPTIONS.map((column) => {
                      const disabled =
                        (column.key === "traffic" || column.key === "conversion") &&
                        cobertura.skusComTraffic === 0
                          ? true
                          : column.key === "buybox" &&
                            cobertura.skusComBuybox15d === 0;
                      return (
                        <ColumnToggle
                          key={column.key}
                          label={column.label}
                          checked={columns[column.key]}
                          disabled={disabled}
                          onChange={(checked) =>
                            setColumns((prev) => ({
                              ...prev,
                              [column.key]: checked,
                            }))
                          }
                        />
                      );
                    })}
                  </PopoverContent>
                </Popover>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  onClick={() => exportarCSV(produtosOrdenados, resumoPorId)}
                >
                  <Download className="h-4 w-4" />
                  Exportar
                </Button>

                <Button
                  type="button"
                  size="sm"
                  className="h-9 gap-2"
                  disabled={syncTudo.isPending}
                  onClick={() => syncTudo.mutate()}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", syncTudo.isPending && "animate-spin")}
                  />
                  Sincronizar com Amazon
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative min-w-0 flex-1 lg:max-w-md">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por SKU, nome ou ASIN..."
                  className="h-10 rounded-lg pl-9"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {filtrosForaPadrao && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    onClick={limparFiltros}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Limpar
                  </Button>
                )}
                <span>
                  {produtosOrdenados.length.toLocaleString("pt-BR")} resultado(s)
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="p-4">
                <DataTableSkeleton rows={8} columns={9} />
              </div>
            ) : produtosOrdenados.length === 0 ? (
              <EmptyState busca={busca} filtros={filtrosConsulta} onLimpar={limparFiltros} />
            ) : (
              <>
                <div className="relative overflow-hidden">
                  <Table className="table-fixed">
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="hidden w-10 px-4 sm:table-cell">
                          <input
                            type="checkbox"
                            aria-label="Selecionar página"
                            checked={todosPaginaSelecionados}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelected((prev) => {
                                const next = new Set(prev);
                                for (const p of produtosPaginados) {
                                  if (checked) next.add(p.id);
                                  else next.delete(p.id);
                                }
                                return next;
                              });
                            }}
                            className="h-4 w-4 rounded border-input accent-primary"
                          />
                        </TableHead>
                        <TableHead className="w-[146px] px-2 sm:w-[220px] lg:w-[260px]">
                          <SortableHeader
                            label="Produto"
                            sortKey="nome"
                            sort={sort}
                            onToggle={toggleSort}
                          />
                        </TableHead>
                        {columns.sku && (
                          <TableHead className="hidden w-[110px] px-2 md:table-cell">
                            <SortableHeader
                              label="SKU"
                              sortKey="sku"
                              sort={sort}
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.asin && (
                          <TableHead className="hidden w-[120px] px-2 2xl:table-cell">
                            ASIN
                          </TableHead>
                        )}
                        {columns.precoAmazon && (
                          <TableHead className="w-[86px] px-2 text-right sm:w-[105px]">
                            <SortableHeader
                              label="Preço Amazon"
                              sortKey="precoAmazon"
                              sort={sort}
                              align="right"
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.estoque && (
                          <TableHead className="hidden w-[90px] px-2 text-right sm:table-cell">
                            <SortableHeader
                              label="Estoque"
                              sortKey="estoqueVendavel"
                              sort={sort}
                              align="right"
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.custo && (
                          <TableHead className="hidden w-[105px] px-2 text-right md:table-cell">
                            <SortableHeader
                              label="Custo"
                              sortKey="custoUnitario"
                              sort={sort}
                              align="right"
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.margem && (
                          <TableHead className="hidden w-[78px] px-2 text-right xl:table-cell">
                            <SortableHeader
                              label="Margem"
                              sortKey="margem"
                              sort={sort}
                              align="right"
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.vendas30d && (
                          <TableHead className="hidden w-[72px] px-2 text-right xl:table-cell">
                            <SortableHeader
                              label="Vendas 30d"
                              sortKey="vendido30d"
                              sort={sort}
                              align="right"
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.traffic && (
                          <TableHead className="hidden w-[95px] px-3 text-right 2xl:table-cell">
                            Sessões
                          </TableHead>
                        )}
                        {columns.conversion && (
                          <TableHead className="hidden w-[90px] px-3 text-right 2xl:table-cell">
                            Conv.
                          </TableHead>
                        )}
                        {columns.buybox && (
                          <TableHead className="hidden w-[95px] px-3 text-right 2xl:table-cell">
                            Buybox
                          </TableHead>
                        )}
                        {columns.ultimaSync && (
                          <TableHead className="hidden w-[120px] px-2 2xl:table-cell">
                            <SortableHeader
                              label="Última sync"
                              sortKey="ultimaSync"
                              sort={sort}
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        {columns.status && (
                          <TableHead className="w-[64px] px-2 sm:w-[82px]">
                            <SortableHeader
                              label="Status"
                              sortKey="status"
                              sort={sort}
                              onToggle={toggleSort}
                            />
                          </TableHead>
                        )}
                        <TableHead className="sticky right-0 z-30 w-[32px] bg-card px-1 shadow-[-1px_0_0_0_hsl(var(--border))] sm:w-[44px] sm:px-2" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtosPaginados.map((p) => {
                        const resumo = resumoPorId.get(p.id);
                        const precoAmazon = getPrecoAmazon(p);
                        const custo = getCusto(p);
                        const margem = getMargemPercent(p);
                        const selecionado = selected.has(p.id);

                        return (
                          <TableRow
                            key={p.id}
                            data-state={selecionado ? "selected" : undefined}
                            className="border-b bg-card transition-colors hover:bg-blue-50/40"
                          >
                            <TableCell className="hidden px-4 py-3 sm:table-cell">
                              <input
                                type="checkbox"
                                aria-label={`Selecionar ${p.sku}`}
                                checked={selecionado}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (checked) next.add(p.id);
                                    else next.delete(p.id);
                                    return next;
                                  });
                                }}
                                className="h-4 w-4 rounded border-input accent-primary"
                              />
                            </TableCell>
                            <TableCell className="px-2 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <ProdutoThumbnail
                                  src={
                                    p.imagemUrl
                                      ? `/api/produtos/${p.id}/imagem`
                                      : resolverImagemProduto(p.amazonImagemUrl, p.asin)
                                  }
                                  alt={p.nome}
                                  title={p.amazonTituloOficial}
                                />
                                <div className="min-w-0">
                                  <Link
                                    href={`/produtos/${p.id}`}
                                    className="line-clamp-2 text-sm font-semibold leading-tight text-slate-900 transition hover:text-primary"
                                    title={p.nome}
                                  >
                                    {p.nome}
                                  </Link>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono">
                                      {p.sku}
                                    </span>
                                    {p.amazonTituloOficial &&
                                      p.amazonTituloOficial !== p.nome && (
                                        <span className="line-clamp-1 max-w-[260px]">
                                          {p.amazonTituloOficial}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            {columns.sku && (
                              <TableCell className="hidden px-2 py-3 md:table-cell">
                                <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs font-medium">
                                  {p.sku}
                                </span>
                              </TableCell>
                            )}
                            {columns.asin && (
                              <TableCell className="hidden px-2 py-3 2xl:table-cell">
                                <AsinCell asin={p.asin} />
                              </TableCell>
                            )}
                            {columns.precoAmazon && (
                              <TableCell className="px-2 py-3">
                                <PriceCell produto={p} />
                              </TableCell>
                            )}
                            {columns.estoque && (
                              <TableCell className="hidden px-2 py-3 sm:table-cell">
                                <EstoqueCell produto={p} />
                              </TableCell>
                            )}
                            {columns.custo && (
                              <TableCell className="hidden px-2 py-3 text-right md:table-cell">
                                <CustoUnitarioInput
                                  produtoId={p.id}
                                  custoUnitario={custo}
                                  disabled={atualizarCusto.isPending}
                                  onSalvar={(produtoId, custoUnitario) =>
                                    atualizarCusto.mutate({ id: produtoId, custoUnitario })
                                  }
                                />
                              </TableCell>
                            )}
                            {columns.margem && (
                              <TableCell className="hidden px-2 py-3 text-right xl:table-cell">
                                <MarginBadge value={margem} />
                              </TableCell>
                            )}
                            {columns.vendas30d && (
                              <TableCell className="hidden px-2 py-3 text-right xl:table-cell">
                                <span className="font-mono text-xs font-semibold tabular-nums text-slate-700">
                                  {formatNumero(resumo?.vendido30d ?? 0)}
                                </span>
                              </TableCell>
                            )}
                            {columns.traffic && (
                              <TableCell className="hidden px-3 py-3 text-right 2xl:table-cell">
                                <span className="font-mono text-xs tabular-nums">
                                  {resumo?.sessions30d
                                    ? formatNumero(resumo.sessions30d)
                                    : "-"}
                                </span>
                              </TableCell>
                            )}
                            {columns.conversion && (
                              <TableCell className="hidden px-3 py-3 text-right 2xl:table-cell">
                                <span className="text-xs font-semibold">
                                  {formatPercent(resumo?.trafficConversionPercent ?? null)}
                                </span>
                              </TableCell>
                            )}
                            {columns.buybox && (
                              <TableCell className="hidden px-3 py-3 text-right 2xl:table-cell">
                                <span className="text-xs font-semibold">
                                  {formatPercent(resumo?.buyboxPercent ?? null)}
                                </span>
                              </TableCell>
                            )}
                            {columns.ultimaSync && (
                              <TableCell className="hidden px-2 py-3 2xl:table-cell">
                                <SyncCell produto={p} />
                              </TableCell>
                            )}
                            {columns.status && (
                              <TableCell className="px-2 py-3">
                                <StatusBadge produto={p} />
                              </TableCell>
                            )}
                            <TableCell className="sticky right-0 z-10 bg-card px-1 py-3 shadow-[-1px_0_0_0_hsl(var(--border))] sm:px-2">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 sm:h-8 sm:w-8"
                                    aria-label={`Ações de ${p.sku}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link href={`/produtos/${p.id}`}>
                                      <Package className="mr-2 h-4 w-4" />
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
                                      setDialogCusto({ aberto: true, produtoId: p.id })
                                    }
                                  >
                                    <History className="mr-2 h-4 w-4" />
                                    Histórico de custo
                                  </DropdownMenuItem>
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
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    Mostrando {produtosOrdenados.length === 0 ? 0 : inicio + 1} a{" "}
                    {Math.min(inicio + pageSize, produtosOrdenados.length)} de{" "}
                    {produtosOrdenados.length.toLocaleString("pt-BR")} produtos
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={String(pageSize)}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-9 w-[124px] text-xs"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size} por página
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      disabled={paginaAtual <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="rounded-md border bg-background px-3 py-2 text-xs font-semibold text-foreground">
                      {paginaAtual} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      disabled={paginaAtual >= totalPages}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <ProdutosFiltrosSheet
          open={filtrosAberto}
          onOpenChange={setFiltrosAberto}
          filtros={filtros}
          onFiltrosChange={onFiltrosChange}
          custoMin={custoMin}
          custoMax={custoMax}
          margemMin={margemMin}
          margemMax={margemMax}
          vendasMin={vendasMin}
          vendasMax={vendasMax}
          onCustoMinChange={setCustoMin}
          onCustoMaxChange={setCustoMax}
          onMargemMinChange={setMargemMin}
          onMargemMaxChange={setMargemMax}
          onVendasMinChange={setVendasMin}
          onVendasMaxChange={setVendasMax}
          onLimpar={limparFiltros}
        />

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

        <DialogCustoHistorico
          aberto={dialogCusto.aberto}
          produtoId={dialogCusto.produtoId}
          onOpenChange={(v) => {
            if (!v) setDialogCusto({ aberto: false, produtoId: null });
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

const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: "sku", label: "SKU" },
  { key: "asin", label: "ASIN" },
  { key: "precoAmazon", label: "Preço Amazon" },
  { key: "estoque", label: "Estoque" },
  { key: "custo", label: "Custo" },
  { key: "margem", label: "Margem" },
  { key: "vendas30d", label: "Vendas 30d" },
  { key: "ultimaSync", label: "Última sync" },
  { key: "status", label: "Status" },
  { key: "traffic", label: "Sessões" },
  { key: "conversion", label: "Conversão" },
  { key: "buybox", label: "Buybox histórico" },
];

function SegmentButton({
  active,
  label,
  count,
  tone = "blue",
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  tone?: "blue" | "green" | "amber";
  onClick: () => void;
}) {
  const countTone = {
    blue: "bg-blue-100 text-blue-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
  }[tone];

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
        active
          ? "border-primary bg-primary/5 text-primary shadow-sm"
          : "border-input bg-background text-slate-600 hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("rounded-full px-2 py-0.5 text-[11px]", countTone)}>
        {count.toLocaleString("pt-BR")}
      </span>
    </button>
  );
}

function ProdutosFiltrosSheet({
  open,
  onOpenChange,
  filtros,
  onFiltrosChange,
  custoMin,
  custoMax,
  margemMin,
  margemMax,
  vendasMin,
  vendasMax,
  onCustoMinChange,
  onCustoMaxChange,
  onMargemMinChange,
  onMargemMaxChange,
  onVendasMinChange,
  onVendasMaxChange,
  onLimpar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filtros: ProdutoFiltrosQuery;
  onFiltrosChange: Dispatch<SetStateAction<ProdutoFiltrosQuery>>;
  custoMin: string;
  custoMax: string;
  margemMin: string;
  margemMax: string;
  vendasMin: string;
  vendasMax: string;
  onCustoMinChange: (value: string) => void;
  onCustoMaxChange: (value: string) => void;
  onMargemMinChange: (value: string) => void;
  onMargemMaxChange: (value: string) => void;
  onVendasMinChange: (value: string) => void;
  onVendasMaxChange: (value: string) => void;
  onLimpar: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription>
            Refine produtos por estoque, custo, margem e sincronização.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 py-4">
          <FilterGroup label="Status">
            <Select
              value={filtros.statusReposicao ?? "TODOS"}
              onChange={(e) => {
                const value = e.target.value;
                onFiltrosChange((prev) => ({
                  ...prev,
                  statusReposicao:
                    value === "TODOS" ? undefined : (value as StatusReposicao),
                }));
              }}
            >
              <option value="TODOS">Todos</option>
              <option value={StatusReposicao.REPOR}>Repor</option>
              <option value={StatusReposicao.ATENCAO}>Atenção</option>
              <option value={StatusReposicao.OK}>OK</option>
            </Select>
          </FilterGroup>

          <FilterGroup label="Estoque">
            <Select
              value={filtros.estoque ?? "TODOS"}
              onChange={(e) => {
                const value = e.target.value;
                onFiltrosChange((prev) => ({
                  ...prev,
                  estoque:
                    value === "TODOS"
                      ? undefined
                      : (value as EstoqueFiltroOperacional),
                }));
              }}
            >
              <option value="TODOS">Todos</option>
              <option value={EstoqueFiltroOperacional.COM_ESTOQUE}>
                Com estoque
              </option>
              <option value={EstoqueFiltroOperacional.SEM_ESTOQUE}>
                Sem estoque
              </option>
            </Select>
          </FilterGroup>

          <FilterGroup label="Custo (R$)">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Mínimo"
                value={custoMin}
                onChange={(e) => onCustoMinChange(e.target.value)}
              />
              <span className="text-muted-foreground">a</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Máximo"
                value={custoMax}
                onChange={(e) => onCustoMaxChange(e.target.value)}
              />
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={!!filtros.semCusto}
                onChange={(e) =>
                  onFiltrosChange((prev) => ({
                    ...prev,
                    semCusto: e.target.checked || undefined,
                  }))
                }
                className="h-4 w-4 accent-primary"
              />
              Apenas sem custo
            </label>
          </FilterGroup>

          <FilterGroup label="Margem (%)">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="number"
                step="0.1"
                placeholder="Mínimo"
                value={margemMin}
                onChange={(e) => onMargemMinChange(e.target.value)}
              />
              <span className="text-muted-foreground">a</span>
              <Input
                type="number"
                step="0.1"
                placeholder="Máximo"
                value={margemMax}
                onChange={(e) => onMargemMaxChange(e.target.value)}
              />
            </div>
          </FilterGroup>

          <FilterGroup label="Vendas 30d">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Mínimo"
                value={vendasMin}
                onChange={(e) => onVendasMinChange(e.target.value)}
              />
              <span className="text-muted-foreground">a</span>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="Máximo"
                value={vendasMax}
                onChange={(e) => onVendasMaxChange(e.target.value)}
              />
            </div>
          </FilterGroup>

          <FilterGroup label="Sincronização Amazon">
            <Select
              value={filtros.semSyncAmazon ? "SEM_SYNC" : "TODOS"}
              onChange={(e) =>
                onFiltrosChange((prev) => ({
                  ...prev,
                  semSyncAmazon: e.target.value === "SEM_SYNC" || undefined,
                }))
              }
            >
              <option value="TODOS">Todos</option>
              <option value="SEM_SYNC">Sem sync Amazon</option>
            </Select>
          </FilterGroup>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Exibir inativos</div>
              <div className="text-xs text-muted-foreground">
                Inclui produtos desativados na lista.
              </div>
            </div>
            <Switch
              checked={filtros.ativo === undefined}
              onCheckedChange={(checked) =>
                onFiltrosChange((prev) => ({
                  ...prev,
                  ativo: checked ? undefined : true,
                }))
              }
              aria-label="Exibir inativos"
            />
          </div>
        </div>

        <SheetFooter className="mt-auto gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onLimpar}>
            Limpar
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Aplicar filtros
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
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
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="ml-auto h-8 w-[88px] text-right font-mono text-xs tabular-nums"
      aria-label="Custo unitário"
      placeholder="0,00"
    />
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
            {diff.produto.sku} - Seller {diff.amazon.sellerId}
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
              <TableHead>Atlas Seller</TableHead>
              <TableHead>Amazon live</TableHead>
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
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700",
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

function parseDecimal(value: string): number | null {
  const normalizado = value.trim().replace(",", ".");
  if (!normalizado) return null;
  const parsed = Number(normalizado);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteiro(value: string): number | null {
  const normalizado = value.trim();
  if (!normalizado) return null;
  const parsed = Number.parseInt(normalizado, 10);
  return Number.isFinite(parsed) ? parsed : null;
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
