"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Filter,
  Package,
  Percent,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderCardList, type VendaListagem } from "@/components/vendas";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Totais = {
  receitaBrutaCentavos: number;
  unidadesVendidas: number;
  quantidadePedidos: number;
  ticketMedioCentavos: number;
  ultimaImportacao: { createdAt: string; tipo: string; mensagem: string | null } | null;
};

type ProdutoReembolso = {
  sku: string;
  nome: string;
  pedidosVendidos: number;
  pedidosReembolsados: number;
  taxaReembolso: number;
  unidadesVendidas: number;
  unidadesReembolsadas: number;
  valorVendidoCentavos: number;
  valorReembolsadoCentavos: number;
};

type PedidoReembolsado = {
  id: string;
  amazonOrderId: string;
  sku: string;
  asin: string | null;
  titulo: string | null;
  quantidade: number;
  valorReembolsadoCentavos: number;
  taxasReembolsadasCentavos: number;
  dataReembolso: string;
  liquidacaoId: string | null;
  statusFinanceiro: string | null;
};

type ReembolsosResponse = {
  totais: {
    produtosAfetados: number;
    pedidosVendidos: number;
    pedidosReembolsados: number;
    taxaReembolso: number;
    unidadesVendidas: number;
    unidadesReembolsadas: number;
    valorVendidoCentavos: number;
    valorReembolsadoCentavos: number;
  };
  produtos: ProdutoReembolso[];
  pedidos: PedidoReembolsado[];
  totalPedidosReembolsados: number;
  porPagina: number;
};

type ResultadoImportacao = {
  tipo: "VENDAS" | "ESTOQUE";
  importadas?: number;
  atualizados?: number;
};

type Filtros = { de: string; ate: string; sku: string; status: string };
type AbaVendas = "principal" | "cancelados" | "reembolsados";

const filtrosIniciais: Filtros = { de: "", ate: "", sku: "", status: "" };

function fmtData(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtPercentual(value: number) {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s.includes("cancel")) return <Badge variant="destructive">{status}</Badge>;
  if (s.includes("reemb") || s.includes("refund")) {
    return <Badge variant="warning">{status}</Badge>;
  }
  if (s.includes("ship") || s.includes("entreg") || s.includes("order")) {
    return <Badge variant="success">{status}</Badge>;
  }
  return <Badge variant="secondary">{status || "PENDENTE"}</Badge>;
}

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-2xl font-semibold tracking-tight">
              {valor}
            </p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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

  const importar = useMutation({
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendas"] });
      queryClient.invalidateQueries({ queryKey: ["vendas-totais"] });
      queryClient.invalidateQueries({ queryKey: ["vendas-reembolsos"] });
      toast.success("Arquivo importado");
      setArquivo(null);
      onFechar();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleArquivo(files: FileList | null) {
    if (!files?.length) return;
    setArquivo(files[0] ?? null);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importar arquivo legado</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-8 text-center transition-colors",
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
            <span className="text-sm text-muted-foreground">
              {arquivo ? arquivo.name : "Clique ou arraste um .xlsx"}
            </span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => handleArquivo(e.target.files)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onFechar}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!arquivo || importar.isPending}
              onClick={() => arquivo && importar.mutate(arquivo)}
            >
              {importar.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Importar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto]);

  const ativos = Object.values(filtros).filter(Boolean).length;

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
        <div className="absolute left-0 top-full z-20 mt-2 w-[min(92vw,520px)] rounded-md border bg-popover p-4 text-popover-foreground shadow-lg">
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
              <Label>Ate</Label>
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
                <option value="Shipped">enviado</option>
                <option value="Pending">pendente</option>
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
              <Button
                size="sm"
                onClick={() => {
                  setFiltros(rascunho);
                  setAberto(false);
                }}
              >
                aplicar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VendasPage() {
  const queryClient = useQueryClient();
  const [filtros, setFiltros] = React.useState<Filtros>(filtrosIniciais);
  const [pagina, setPagina] = React.useState(1);
  const [dialogAberto, setDialogAberto] = React.useState(false);
  const [aba, setAba] = React.useState<AbaVendas>("principal");
  const visaoVendas = aba === "cancelados" ? "cancelados" : "principal";

  React.useEffect(() => setPagina(1), [filtros, aba]);

  const params = React.useMemo(() => {
    const p = new URLSearchParams();
    if (filtros.de) p.set("de", filtros.de);
    if (filtros.ate) p.set("ate", filtros.ate);
    if (filtros.sku) p.set("sku", filtros.sku);
    if (filtros.status) p.set("status", filtros.status);
    p.set("visao", visaoVendas);
    p.set("pagina", String(pagina));
    return p;
  }, [filtros, pagina, visaoVendas]);

  const totaisParams = React.useMemo(() => {
    const p = new URLSearchParams();
    if (filtros.de) p.set("de", filtros.de);
    if (filtros.ate) p.set("ate", filtros.ate);
    p.set("visao", visaoVendas);
    return p;
  }, [filtros.de, filtros.ate, visaoVendas]);

  const vendasQuery = useQuery<{
    vendas: VendaListagem[];
    total: number;
    porPagina: number;
  }>({
    queryKey: ["vendas", filtros, pagina, visaoVendas],
    queryFn: () => fetch(`/api/vendas?${params}`).then((r) => r.json()),
  });

  const totaisQuery = useQuery<Totais>({
    queryKey: ["vendas-totais", filtros.de, filtros.ate, visaoVendas],
    queryFn: () => fetch(`/api/vendas/totais?${totaisParams}`).then((r) => r.json()),
  });

  const reembolsosQuery = useQuery<ReembolsosResponse>({
    queryKey: ["vendas-reembolsos", filtros, pagina],
    queryFn: () => fetch(`/api/vendas/reembolsos?${params}`).then((r) => r.json()),
    enabled: aba === "reembolsados",
  });

  const sincronizar = useMutation({
    mutationFn: async () => {
      const orders = await fetch("/api/amazon/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo: "ORDERS", diasAtras: 30 }),
      });
      if (!orders.ok) {
        const json = await orders.json();
        throw new Error(json.erro ?? "Erro ao sincronizar Amazon");
      }
      const pedidos = await orders.json();

      let avisoReembolsos: string | null = null;
      try {
        const refunds = await fetch("/api/amazon/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tipo: "REFUNDS", diasAtras: 90 }),
        });
        if (!refunds.ok) {
          const json = await refunds.json();
          avisoReembolsos = json.erro ?? "Reembolsos nao sincronizados";
        }
      } catch (err) {
        avisoReembolsos =
          err instanceof Error ? err.message : "Reembolsos nao sincronizados";
      }

      return { pedidos, avisoReembolsos };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["vendas"] });
      queryClient.invalidateQueries({ queryKey: ["vendas-totais"] });
      queryClient.invalidateQueries({ queryKey: ["vendas-reembolsos"] });
      queryClient.invalidateQueries({ queryKey: ["produtos"] });
      if (data.pedidos?.rateLimited) {
        toast.warning(
          data.pedidos.mensagem ??
            "Amazon limitou a sincronizacao. Tente novamente em alguns minutos.",
        );
      } else if (data.pedidos?.queued) {
        toast.success("Sincronizacao Amazon enfileirada.");
      } else {
        toast.success("Amazon sincronizada");
      }
      if (data.avisoReembolsos) {
        toast.warning(data.avisoReembolsos);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const vendas = vendasQuery.data?.vendas ?? [];
  const total = vendasQuery.data?.total ?? 0;
  const porPagina = vendasQuery.data?.porPagina ?? 50;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const totais = totaisQuery.data;
  const reembolsos = reembolsosQuery.data;

  const filtrosAtivos = Object.entries(filtros).filter(([, value]) =>
    Boolean(value),
  );

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="Vendas Amazon"
        description={
          totais?.ultimaImportacao
            ? `Última sincronização: ${fmtData(totais.ultimaImportacao.createdAt)}`
            : "Pedidos, taxas, líquido e reembolsos pela Amazon SP-API"
        }
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialogAberto(true)}
        >
          <Upload className="mr-2 h-4 w-4" />
          Importar
        </Button>
        <Button
          size="sm"
          onClick={() => sincronizar.mutate()}
          disabled={sincronizar.isPending}
        >
          {sincronizar.isPending ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Zap className="mr-2 h-4 w-4" />
          )}
          Sincronizar
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricaCard
          label="Receita Bruta"
          valor={formatBRL(totais?.receitaBrutaCentavos ?? 0)}
          icon={TrendingUp}
        />
        <MetricaCard
          label="Pedidos"
          valor={String(totais?.quantidadePedidos ?? 0)}
          sub="pedidos únicos"
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

      <div className="flex flex-wrap items-center gap-2">
        <PainelFiltros filtros={filtros} setFiltros={setFiltros} />
        {filtrosAtivos.map(([chave, valor]) => (
          <Badge
            key={chave}
            variant="secondary"
            className="flex items-center gap-1 pr-1"
          >
            {chave}: {valor}
            <button
              className="ml-1 rounded-sm hover:bg-muted"
              onClick={() => setFiltros({ ...filtros, [chave]: "" })}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {filtrosAtivos.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => setFiltros(filtrosIniciais)}
          >
            limpar todos
          </Button>
        )}
      </div>

      <Tabs
        value={aba}
        onValueChange={(value) => setAba(value as AbaVendas)}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="principal">Pedidos</TabsTrigger>
          <TabsTrigger value="cancelados">Cancelados</TabsTrigger>
          <TabsTrigger value="reembolsados">Reembolsados</TabsTrigger>
        </TabsList>

        <TabsContent value="principal" className="mt-4">
          <OrderCardList
            isLoading={vendasQuery.isLoading}
            vendas={vendas}
            pagina={pagina}
            totalPaginas={totalPaginas}
            total={total}
            setPagina={setPagina}
            onImportar={() => setDialogAberto(true)}
          />
        </TabsContent>

        <TabsContent value="cancelados" className="mt-4">
          <OrderCardList
            isLoading={vendasQuery.isLoading}
            vendas={vendas}
            pagina={pagina}
            totalPaginas={totalPaginas}
            total={total}
            setPagina={setPagina}
            emptyHint="Nenhum pedido cancelado no período"
          />
        </TabsContent>

        <TabsContent value="reembolsados" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricaCard
              label="Taxa de Reembolso"
              valor={fmtPercentual(reembolsos?.totais.taxaReembolso ?? 0)}
              sub={`${reembolsos?.totais.pedidosReembolsados ?? 0} pedidos`}
              icon={Percent}
            />
            <MetricaCard
              label="Valor Reembolsado"
              valor={formatBRL(reembolsos?.totais.valorReembolsadoCentavos ?? 0)}
              icon={RotateCcw}
            />
            <MetricaCard
              label="Produtos Afetados"
              valor={String(reembolsos?.totais.produtosAfetados ?? 0)}
              icon={Package}
            />
            <MetricaCard
              label="Unidades"
              valor={String(reembolsos?.totais.unidadesReembolsadas ?? 0)}
              sub="reembolsadas"
              icon={ShoppingBag}
            />
          </div>

          {reembolsosQuery.isLoading ? (
            <DataTableSkeleton rows={6} columns={8} />
          ) : (
            <>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Vendidos</TableHead>
                      <TableHead className="text-right">Reembolsados</TableHead>
                      <TableHead className="text-right">Taxa</TableHead>
                      <TableHead className="text-right">Unid.</TableHead>
                      <TableHead className="text-right">Vendido</TableHead>
                      <TableHead className="text-right">Reembolsado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reembolsos?.produtos ?? []).map((produto) => (
                      <TableRow key={produto.sku}>
                        <TableCell className="font-medium">{produto.sku}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="line-clamp-1 text-sm text-muted-foreground">
                            {produto.nome}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.pedidosVendidos}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.pedidosReembolsados}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {fmtPercentual(produto.taxaReembolso)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {produto.unidadesReembolsadas}/{produto.unidadesVendidas}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(produto.valorVendidoCentavos)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatBRL(produto.valorReembolsadoCentavos)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="hidden md:table-cell">Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reembolsos?.pedidos ?? []).map((pedido) => (
                      <TableRow key={pedido.id}>
                        <TableCell className="tabular-nums">
                          {fmtData(pedido.dataReembolso)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {pedido.amazonOrderId}
                        </TableCell>
                        <TableCell className="font-medium">{pedido.sku}</TableCell>
                        <TableCell className="hidden max-w-[260px] md:table-cell">
                          <span className="line-clamp-1 text-sm text-muted-foreground">
                            {pedido.titulo ?? "-"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pedido.quantidade}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatBRL(pedido.valorReembolsadoCentavos)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={pedido.statusFinanceiro ?? "REEMBOLSADO"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <DialogImportar aberto={dialogAberto} onFechar={() => setDialogAberto(false)} />
    </div>
  );
}
