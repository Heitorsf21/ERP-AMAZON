"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Filter,
  Inbox,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/money";
import { formatData } from "@/lib/date";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import {
  OrigemMovimentacao,
  TipoMovimentacao,
} from "@/modules/shared/domain";

type Movimentacao = {
  id: string;
  tipo: string;
  valor: number;
  dataCaixa: string;
  descricao: string;
  origem: string;
  motivoAjuste: string | null;
  categoria: { id: string; nome: string; cor: string | null };
};

type Filtros = {
  de: string;
  ate: string;
  tipo: string;
  categoriaId: string;
  origem: string;
};

const filtrosIniciais: Filtros = {
  de: "",
  ate: "",
  tipo: "",
  categoriaId: "",
  origem: "",
};

const rotulosFiltro: Record<keyof Filtros, string> = {
  de: "De",
  ate: "Até",
  tipo: "Tipo",
  categoriaId: "Categoria",
  origem: "Origem",
};

function badgeOrigem(origem: string) {
  switch (origem) {
    case OrigemMovimentacao.AJUSTE:
      return <Badge variant="warning">ajuste</Badge>;
    case OrigemMovimentacao.IMPORTACAO:
      return <Badge variant="secondary">importada</Badge>;
    case OrigemMovimentacao.CONTA_PAGA:
      return <Badge variant="outline">conta paga</Badge>;
    default:
      return <Badge variant="outline">manual</Badge>;
  }
}

export function ListaMovimentacoes() {
  const qc = useQueryClient();
  const [filtros, setFiltros] = React.useState<Filtros>(filtrosIniciais);
  const [expandidos, setExpandidos] = React.useState<Set<string>>(new Set());
  const [colapsado, setColapsado] = React.useState(false);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) if (v) params.set(k, v);
  const query = params.toString();

  const {
    data: movimentacoes = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<Movimentacao[]>({
    queryKey: ["movimentacoes", query],
    queryFn: () =>
      fetchJSON<Movimentacao[]>(
        `/api/movimentacoes${query ? `?${query}` : ""}`,
      ),
  });

  const { data: categorias = [] } = useQuery<{ id: string; nome: string }[]>({
    queryKey: ["categorias"],
    queryFn: () => fetchJSON("/api/categorias"),
  });

  const remover = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/movimentacoes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      toast.success("Movimentação removida");
    },
    onError: () => toast.error("Erro ao remover movimentação"),
  });

  const filtrosAtivos = React.useMemo(() => {
    const itens: { chave: keyof Filtros; valor: string; rotulo: string }[] = [];
    for (const k of Object.keys(filtros) as (keyof Filtros)[]) {
      const v = filtros[k];
      if (!v) continue;
      let rotulo = v;
      if (k === "categoriaId") {
        rotulo = categorias.find((c) => c.id === v)?.nome ?? v;
      } else if (k === "tipo") {
        rotulo = v === TipoMovimentacao.ENTRADA ? "entrada" : "saída";
      } else if (k === "origem") {
        rotulo = v.toLowerCase().replace("_", " ");
      }
      itens.push({ chave: k, valor: v, rotulo: `${rotulosFiltro[k]}: ${rotulo}` });
    }
    return itens;
  }, [filtros, categorias]);

  function toggleExpandido(id: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const contador = isLoading
    ? "—"
    : `${movimentacoes.length} movimentação(ões)`;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setColapsado((v) => !v)}
          className={cn(
            "group inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-sm font-semibold transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-expanded={!colapsado}
          aria-label={colapsado ? "Expandir movimentações" : "Recolher movimentações"}
        >
          {colapsado ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground" />
          )}
          Movimentações
          <span className="text-xs font-normal text-muted-foreground">
            {contador}
          </span>
          {filtrosAtivos.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {filtrosAtivos.length} filtro{filtrosAtivos.length > 1 ? "s" : ""}
            </Badge>
          )}
        </button>
      </div>

      {!colapsado && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <PopoverFiltros
              filtros={filtros}
              setFiltros={setFiltros}
              categorias={categorias}
              quantidadeAtivos={filtrosAtivos.length}
            />
            {filtrosAtivos.map((f) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => setFiltros({ ...filtros, [f.chave]: "" })}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted"
                title="Remover filtro"
              >
                {f.rotulo}
                <X className="h-3 w-3 opacity-60" />
              </button>
            ))}
            {filtrosAtivos.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setFiltros(filtrosIniciais)}
              >
                limpar tudo
              </Button>
            )}
          </div>

          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-[110px]">Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-[140px] text-right">Valor</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                      <TableCell className="pl-3 pr-0">
                        <Skeleton className="h-3.5 w-3.5" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-[60%] max-w-[380px]" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="ml-auto h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-8 w-8 rounded-md" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && isError && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                          <AlertCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Não foi possível carregar</p>
                          <p className="text-xs text-muted-foreground">
                            Verifique sua conexão e tente de novo.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => refetch()}
                          disabled={isRefetching}
                        >
                          <RotateCw
                            className={cn(
                              "mr-2 h-3.5 w-3.5",
                              isRefetching && "animate-spin",
                            )}
                          />
                          Tentar de novo
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && movimentacoes.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Inbox className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Nenhuma movimentação</p>
                          <p className="text-xs text-muted-foreground">
                            {filtrosAtivos.length > 0
                              ? "Tente ajustar ou limpar os filtros."
                              : "Cadastre a primeira movimentação para começar."}
                          </p>
                        </div>
                        {filtrosAtivos.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFiltros(filtrosIniciais)}
                          >
                            limpar filtros
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && movimentacoes.map((m) => {
              const aberto = expandidos.has(m.id);
              return (
                <React.Fragment key={m.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => toggleExpandido(m.id)}
                  >
                    <TableCell className="pl-3 pr-0">
                      {aberto ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatData(new Date(m.dataCaixa))}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{m.descricao}</span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        m.tipo === TipoMovimentacao.ENTRADA
                          ? "text-emerald-600"
                          : "text-destructive",
                      )}
                    >
                      {m.tipo === TipoMovimentacao.ENTRADA ? "+" : "−"}
                      {formatBRL(m.valor)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {m.origem !== OrigemMovimentacao.CONTA_PAGA && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remover.mutate(m.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>

                  {/* Linha de detalhes expandida */}
                  {aberto && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell />
                      <TableCell colSpan={4} className="pb-3 pt-1">
                        <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">Categoria:</span>{" "}
                            {m.categoria.nome}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Origem:</span>{" "}
                            {badgeOrigem(m.origem)}
                          </div>
                          {m.motivoAjuste && (
                            <div>
                              <span className="font-medium text-foreground">Motivo:</span>{" "}
                              {m.motivoAjuste}
                            </div>
                          )}
                          <div>
                            <span className="font-medium text-foreground">ID:</span>{" "}
                            <span className="font-mono">{m.id}</span>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

function PopoverFiltros({
  filtros,
  setFiltros,
  categorias,
  quantidadeAtivos,
}: {
  filtros: Filtros;
  setFiltros: (f: Filtros) => void;
  categorias: { id: string; nome: string }[];
  quantidadeAtivos: number;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Filtros>(filtros);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (aberto) setRascunho(filtros);
  }, [aberto, filtros]);

  React.useEffect(() => {
    if (!aberto) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false);
      }
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

  function aplicar() {
    setFiltros(rascunho);
    setAberto(false);
  }

  function limpar() {
    setRascunho(filtrosIniciais);
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
        {quantidadeAtivos > 0 && (
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
            {quantidadeAtivos}
          </Badge>
        )}
      </Button>

      {aberto && (
        <div
          className={cn(
            "absolute left-0 top-full z-50 mt-2 w-[min(92vw,520px)]",
            "rounded-lg border bg-popover p-4 text-popover-foreground shadow-xl",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150",
          )}
        >
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
              <Label>Tipo</Label>
              <Select
                value={rascunho.tipo}
                onChange={(e) => setRascunho({ ...rascunho, tipo: e.target.value })}
              >
                <option value="">todos</option>
                <option value={TipoMovimentacao.ENTRADA}>entrada</option>
                <option value={TipoMovimentacao.SAIDA}>saída</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Origem</Label>
              <Select
                value={rascunho.origem}
                onChange={(e) => setRascunho({ ...rascunho, origem: e.target.value })}
              >
                <option value="">todas</option>
                <option value={OrigemMovimentacao.MANUAL}>manual</option>
                <option value={OrigemMovimentacao.IMPORTACAO}>importação</option>
                <option value={OrigemMovimentacao.CONTA_PAGA}>conta paga</option>
                <option value={OrigemMovimentacao.AJUSTE}>ajuste</option>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Categoria</Label>
              <Select
                value={rascunho.categoriaId}
                onChange={(e) => setRascunho({ ...rascunho, categoriaId: e.target.value })}
              >
                <option value="">todas</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={limpar}>
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
