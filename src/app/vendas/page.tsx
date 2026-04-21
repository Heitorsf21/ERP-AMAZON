"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  ShoppingBag,
  Package,
  TrendingUp,
  ReceiptText,
  Filter,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────────────────────

type Venda = {
  id: string;
  numeroPedido: string;
  marketplace: string | null;
  status: string;
  dataCompra: string;
  skuExterno: string;
  titulo: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  totalCentavos: number;
};

type Totais = {
  receitaBrutaCentavos: number;
  unidadesVendidas: number;
  quantidadePedidos: number;
  ticketMedioCentavos: number;
  ultimaImportacao: { createdAt: string; tipo: string; nomeArquivo: string } | null;
};

type ResultadoImportacao = {
  tipo: "VENDAS" | "ESTOQUE";
  importadas?: number;
  periodoInicio?: string;
  periodoFim?: string;
  totalSkus?: number;
  atualizados?: number;
  naoEncontrados?: string[];
};

type ResultadoSincronizacao = {
  scriptLog?: string;
  resultados: ResultadoImportacao[];
  erros: { relatorio: string; erro: string }[];
};

type Filtros = { de: string; ate: string; sku: string; status: string };

// ── Utilidades ───────────────────────────────────────────────────────────────

function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "enviado" || s === "entregue")
    return <Badge variant="success">{status}</Badge>;
  if (s === "cancelado")
    return <Badge variant="destructive">{status}</Badge>;
  if (s === "reembolsado")
    return <Badge variant="outline" className="text-warning border-warning">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

// ── Card de métrica ──────────────────────────────────────────────────────────

function MetricaCard({
  label,
  valor,
  sub,
  icon: Icon,
}: {
  label: string;
  valor: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight truncate">{valor}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Dialog de importação ─────────────────────────────────────────────────────

function DialogImportar({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [resultado, setResultado] = React.useState<ResultadoImportacao | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("arquivo", file);
      const res = await fetch("/api/vendas/importar", { method: "POST", body: form });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.erro ?? "Erro ao importar");
      }
      return res.json() as Promise<ResultadoImportacao>;
    },
    onSuccess: (data) => {
      setResultado(data);
      queryClient.invalidateQueries({ queryKey: ["vendas"] });
      queryClient.invalidateQueries({ queryKey: ["vendas-totais"] });
      if (data.tipo === "ESTOQUE") {
        queryClient.invalidateQueries({ queryKey: ["estoque-totais"] });
        queryClient.invalidateQueries({ queryKey: ["produtos"] });
      }
    },
    onError: (err) => toast.error(err.message),
  });

  function handleFechar() {
    setArquivo(null);
    setResultado(null);
    onFechar();
  }

  function handleArquivo(files: FileList | null) {
    if (!files?.length) return;
    setArquivo(files[0] ?? null);
    setResultado(null);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && handleFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importar Relatório FBA</DialogTitle>
        </DialogHeader>

        {!resultado ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Aceita <strong>reports_sales.xlsx</strong> (vendas) ou{" "}
              <strong>reports_fba_stock.xlsx</strong> (sincroniza estoque automaticamente).
            </p>

            {/* Drop zone */}
            <div
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                arquivo
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30",
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleArquivo(e.dataTransfer.files);
              }}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              {arquivo ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-primary">{arquivo.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setArquivo(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Clique ou arraste o arquivo .xlsx aqui
                </span>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => handleArquivo(e.target.files)}
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleFechar}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!arquivo || isPending}
                onClick={() => arquivo && mutate(arquivo)}
              >
                {isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {isPending ? "Importando…" : "Importar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {resultado.tipo === "VENDAS" ? (
              <>
                <div className="rounded-lg border bg-success/5 p-4 text-center">
                  <p className="text-2xl font-bold text-success">{resultado.importadas}</p>
                  <p className="text-sm text-muted-foreground">vendas importadas</p>
                </div>
                {resultado.periodoInicio && (
                  <p className="text-center text-sm text-muted-foreground">
                    Período: {fmtData(resultado.periodoInicio)} →{" "}
                    {fmtData(resultado.periodoFim)}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="rounded-lg border bg-success/5 p-4 text-center">
                  <p className="text-2xl font-bold text-success">{resultado.atualizados}</p>
                  <p className="text-sm text-muted-foreground">
                    produtos com estoque atualizado
                  </p>
                </div>
                {resultado.naoEncontrados && resultado.naoEncontrados.length > 0 && (
                  <div className="rounded-lg border bg-warning/5 p-3">
                    <p className="text-xs font-medium text-warning">
                      {resultado.naoEncontrados.length} SKU(s) não encontrados no sistema:
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resultado.naoEncontrados.slice(0, 5).join(", ")}
                      {resultado.naoEncontrados.length > 5 && "…"}
                    </p>
                  </div>
                )}
              </>
            )}
            <Button className="w-full" onClick={handleFechar}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Filtros inline ────────────────────────────────────────────────────────────

const filtrosIniciais: Filtros = { de: "", ate: "", sku: "", status: "" };

function PainelFiltros({
  filtros,
  setFiltros,
}: {
  filtros: Filtros;
  setFiltros: (f: Filtros) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Filtros>(filtros);

  React.useEffect(() => {
    if (aberto) setRascunho(filtros);
  }, [aberto, filtros]);

  React.useEffect(() => {
    if (!aberto) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [aberto]);

  const ativos = Object.values(filtros).filter(Boolean).length;

  function aplicar() {
    setFiltros(rascunho);
    setAberto(false);
  }

  return (
    <div ref={ref} className="relative">
      <Button
        variant={aberto ? "default" : "secondary"}
        size="sm"
        onClick={() => setAberto((v) => !v)}
        className="gap-2"
      >
        <Filter className="h-4 w-4" />
        Filtros
        {ativos > 0 && (
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
            {ativos}
          </Badge>
        )}
      </Button>

      {aberto && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[min(92vw,480px)] rounded-md border bg-popover p-4 text-popover-foreground shadow-lg">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>De</Label>
              <Input
                type="date"
                value={rascunho.de}
                onChange={(e) => setRascunho({ ...rascunho, de: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Até</Label>
              <Input
                type="date"
                value={rascunho.ate}
                onChange={(e) => setRascunho({ ...rascunho, ate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>SKU</Label>
              <Input
                placeholder="ex: MFS-0017"
                value={rascunho.sku}
                onChange={(e) => setRascunho({ ...rascunho, sku: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <select
                value={rascunho.status}
                onChange={(e) => setRascunho({ ...rascunho, status: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">todos</option>
                <option value="Enviado">Enviado</option>
                <option value="Pendente">Pendente</option>
                <option value="Cancelado">Cancelado</option>
                <option value="Reembolsado">Reembolsado</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRascunho(filtrosIniciais)}
            >
              limpar
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAberto(false)}>
                cancelar
              </Button>
              <Button size="sm" onClick={aplicar}>
                aplicar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function VendasPage() {
  const queryClient = useQueryClient();
  const [filtros, setFiltros] = React.useState<Filtros>(filtrosIniciais);
  const [pagina, setPagina] = React.useState(1);
  const [dialogAberto, setDialogAberto] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState<ResultadoSincronizacao | null>(null);

  React.useEffect(() => { setPagina(1); }, [filtros]);

  const sincronizar = useMutation({
    mutationFn: async () => {
      const p = new URLSearchParams({ relatorio: "todos" });
      if (filtros.de) p.set("de", filtros.de);
      if (filtros.ate) p.set("ate", filtros.ate);
      const res = await fetch(`/api/vendas/sincronizar?${p}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.erro ?? "Erro ao sincronizar");
      }
      return res.json() as Promise<ResultadoSincronizacao>;
    },
    onSuccess: (data) => {
      setSyncResult(data);
      queryClient.invalidateQueries({ queryKey: ["vendas"] });
      queryClient.invalidateQueries({ queryKey: ["vendas-totais"] });
      queryClient.invalidateQueries({ queryKey: ["estoque-totais"] });
      queryClient.invalidateQueries({ queryKey: ["produtos"] });
      const ok = data.resultados.length;
      const fail = data.erros.length;
      if (ok > 0) toast.success(`Sincronizado: ${ok} relatório(s) importado(s)`);
      if (fail > 0) toast.warning(`${fail} relatório(s) não encontrado(s) ou com erro`);
    },
    onError: (err) => toast.error(err.message),
  });

  const params = new URLSearchParams();
  if (filtros.de) params.set("de", filtros.de);
  if (filtros.ate) params.set("ate", filtros.ate);
  if (filtros.sku) params.set("sku", filtros.sku);
  if (filtros.status) params.set("status", filtros.status);
  params.set("pagina", String(pagina));

  const totaisParams = new URLSearchParams();
  if (filtros.de) totaisParams.set("de", filtros.de);
  if (filtros.ate) totaisParams.set("ate", filtros.ate);

  const { data: totais } = useQuery<Totais>({
    queryKey: ["vendas-totais", filtros.de, filtros.ate],
    queryFn: () => fetch(`/api/vendas/totais?${totaisParams}`).then((r) => r.json()),
  });

  const { data, isLoading } = useQuery<{ vendas: Venda[]; total: number; porPagina: number }>({
    queryKey: ["vendas", filtros, pagina],
    queryFn: () => fetch(`/api/vendas?${params}`).then((r) => r.json()),
  });

  const vendas = data?.vendas ?? [];
  const total = data?.total ?? 0;
  const porPagina = data?.porPagina ?? 50;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  const filtrosAtivos = Object.entries(filtros)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => ({ chave: k as keyof Filtros, valor: v }));

  const rotulos: Record<keyof Filtros, string> = {
    de: "De",
    ate: "Até",
    sku: "SKU",
    status: "Status",
  };

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="Vendas FBA"
        description={
          totais?.ultimaImportacao
            ? `Última importação: ${fmtData(totais.ultimaImportacao.createdAt)} — ${totais.ultimaImportacao.nomeArquivo}`
            : "Sincronize com o Gestor Seller ou importe o .xlsx manualmente"
        }
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => sincronizar.mutate()}
          disabled={sincronizar.isPending}
          title="Baixa os relatórios do Gestor Seller automaticamente via script Python"
        >
          {sincronizar.isPending ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Zap className="mr-2 h-4 w-4" />
          )}
          {sincronizar.isPending ? "Sincronizando…" : "Sincronizar"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDialogAberto(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Importar
        </Button>
      </PageHeader>

      {/* Resultado da sincronização */}
      {syncResult && (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              {syncResult.resultados.map((r, i) => (
                <p key={i} className="text-success">
                  {r.tipo === "VENDAS"
                    ? `✓ Vendas: ${r.importadas} registros importados`
                    : `✓ Estoque: ${r.atualizados} produtos atualizados`}
                </p>
              ))}
              {syncResult.erros.map((e, i) => (
                <p key={i} className="text-warning">
                  ⚠ {e.relatorio}: {e.erro}
                </p>
              ))}
            </div>
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setSyncResult(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricaCard
          label="Receita Bruta"
          valor={formatBRL(totais?.receitaBrutaCentavos ?? 0)}
          icon={TrendingUp}
        />
        <MetricaCard
          label="Pedidos"
          valor={String(totais?.quantidadePedidos ?? 0)}
          sub="pedidos no período"
          icon={ReceiptText}
        />
        <MetricaCard
          label="Unidades"
          valor={String(totais?.unidadesVendidas ?? 0)}
          sub="unidades vendidas"
          icon={Package}
        />
        <MetricaCard
          label="Ticket Médio"
          valor={formatBRL(totais?.ticketMedioCentavos ?? 0)}
          sub="por pedido"
          icon={ShoppingBag}
        />
      </div>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <PainelFiltros filtros={filtros} setFiltros={setFiltros} />
        {filtrosAtivos.map((f) => (
          <Badge
            key={f.chave}
            variant="secondary"
            className="flex items-center gap-1 pr-1"
          >
            {rotulos[f.chave]}: {f.valor}
            <button
              className="ml-1 rounded-sm hover:bg-muted"
              onClick={() => setFiltros({ ...filtros, [f.chave]: "" })}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {filtrosAtivos.length > 1 && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setFiltros(filtrosIniciais)}
          >
            limpar todos
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} {total === 1 ? "venda" : "vendas"}
        </span>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <DataTableSkeleton rows={8} columns={6} />
      ) : vendas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <ShoppingBag className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="font-medium text-muted-foreground">
              {Object.values(filtros).some(Boolean)
                ? "Nenhuma venda encontrada com esses filtros"
                : "Nenhuma venda importada ainda"}
            </p>
            {!Object.values(filtros).some(Boolean) && (
              <p className="mt-1 text-sm text-muted-foreground">
                Importe o relatório de vendas do Gestor Seller para começar.
              </p>
            )}
          </div>
          {!Object.values(filtros).some(Boolean) && (
            <Button size="sm" onClick={() => setDialogAberto(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Importar Relatório
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead className="hidden sm:table-cell">Pedido</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="hidden md:table-cell max-w-[220px]">Título</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendas.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-sm tabular-nums">
                      {fmtData(v.dataCompra)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground font-mono">
                      {v.numeroPedido}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{v.skuExterno}</TableCell>
                    <TableCell className="hidden md:table-cell max-w-[220px]">
                      <span className="line-clamp-1 text-sm text-muted-foreground" title={v.titulo ?? ""}>
                        {v.titulo ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.quantidade}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatBRL(v.totalCentavos)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge status={v.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Paginação */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {pagina} de {totalPaginas}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <DialogImportar aberto={dialogAberto} onFechar={() => setDialogAberto(false)} />
    </div>
  );
}
