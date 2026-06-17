"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Trash2, Undo2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { StatusConta } from "@/modules/shared/domain";

type Conta = {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  recorrencia: string;
  contaFixaId: string | null;
  nfNome: string | null;
  fornecedor: { id: string; nome: string };
  categoria: { id: string; nome: string };
  dossieFinanceiro: {
    id: string;
    documentos: { id: string; tipo: string; nomeArquivo: string }[];
  } | null;
};

type TotaisMes = {
  qtdVencidas: number;
};

type Aba = "ABERTA" | "VENCIDA" | "PAGA" | "TODAS";
type PeriodoRapido = "HOJE" | "ONTEM" | "7_DIAS" | "30_DIAS" | "VITALICIO";

const abaLabel: Record<Aba, string> = {
  ABERTA: "Abertas",
  VENCIDA: "Vencidas",
  PAGA: "Pagas",
  TODAS: "Todas",
};

const periodoLabel: Record<PeriodoRapido, string> = {
  HOJE: "Hoje",
  ONTEM: "Ontem",
  "7_DIAS": "7 dias",
  "30_DIAS": "30 dias",
  VITALICIO: "Vitalício",
};

// Cor do ponto de status no início da linha — substitui a poluição de badges.
// vermelho = vencida · âmbar = aberta/a vencer · verde = paga · slate = outros.
function corDotStatus(status: string) {
  switch (status) {
    case StatusConta.VENCIDA:
      return "bg-destructive";
    case StatusConta.ABERTA:
      return "bg-amber-500";
    case StatusConta.PAGA:
      return "bg-emerald-500";
    default:
      return "bg-slate-400";
  }
}

function rotuloStatus(status: string) {
  switch (status) {
    case StatusConta.VENCIDA:
      return "vencida";
    case StatusConta.ABERTA:
      return "aberta";
    case StatusConta.PAGA:
      return "paga";
    case StatusConta.CANCELADA:
      return "cancelada";
    default:
      return status.toLowerCase();
  }
}

function formatData(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function addDiasISO(baseISO: string, dias: number) {
  const [ano, mes, dia] = baseISO.split("-").map(Number);
  const data = new Date(ano!, mes! - 1, dia!);
  data.setDate(data.getDate() + dias);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;
}

function rangePeriodo(periodo: PeriodoRapido, aba: Aba) {
  const hoje = hojeISO();
  const olharParaTras = aba === "VENCIDA" || aba === "PAGA";
  switch (periodo) {
    case "HOJE":
      return { de: hoje, ate: hoje };
    case "ONTEM": {
      const ontem = addDiasISO(hoje, -1);
      return { de: ontem, ate: ontem };
    }
    case "7_DIAS":
      return olharParaTras
        ? { de: addDiasISO(hoje, -6), ate: hoje }
        : { de: hoje, ate: addDiasISO(hoje, 6) };
    case "30_DIAS":
      return olharParaTras
        ? { de: addDiasISO(hoje, -29), ate: hoje }
        : { de: hoje, ate: addDiasISO(hoje, 29) };
    case "VITALICIO":
      return {};
  }
}

export function ListaContas() {
  const qc = useQueryClient();
  const [aba, setAba] = React.useState<Aba>("ABERTA");
  const [periodo, setPeriodo] = React.useState<PeriodoRapido>("VITALICIO");
  const [contaParaPagar, setContaParaPagar] = React.useState<Conta | null>(null);
  const [pagoEm, setPagoEm] = React.useState(hojeISO());

  const statusFiltro = aba === "TODAS" ? undefined : aba;
  const periodoRange = rangePeriodo(periodo, aba);
  const params = new URLSearchParams();
  if (statusFiltro) params.set("status", statusFiltro);
  if (periodoRange.de) params.set("de", periodoRange.de);
  if (periodoRange.ate) params.set("ate", periodoRange.ate);
  const queryString = params.toString();
  const urlContas = `/api/contas${queryString ? `?${queryString}` : ""}`;

  const { data: contas = [], isLoading } = useQuery<Conta[]>({
    queryKey: ["contas", statusFiltro, periodo],
    queryFn: () => fetchJSON<Conta[]>(urlContas),
  });

  // Mesma queryKey usada pelo header da página — react-query deduplica
  // (sem requisição extra). Usado apenas para o contador da aba "Vencidas".
  const { data: totais } = useQuery<TotaisMes>({
    queryKey: ["contas-totais-mes"],
    queryFn: () => fetchJSON<TotaisMes>("/api/contas/totais"),
  });

  const pagar = useMutation({
    mutationFn: ({ id, pagoEm }: { id: string; pagoEm: string }) =>
      fetchJSON(`/api/contas/${id}/pagar`, {
        method: "POST",
        body: JSON.stringify({ pagoEm }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      setContaParaPagar(null);
      toast.success("Pagamento registrado");
    },
    onError: (err) => toast.error((err as Error).message ?? "Erro ao pagar"),
  });

  const remover = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/contas/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      toast.success("Conta removida");
    },
    onError: (err) => toast.error((err as Error).message ?? "Erro ao remover conta"),
  });

  const reverter = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/contas/${id}/reverter`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      toast.success("Pagamento revertido");
    },
    onError: (err) =>
      toast.error((err as Error).message ?? "Erro ao reverter pagamento"),
  });

  const abas: Aba[] = ["ABERTA", "VENCIDA", "PAGA", "TODAS"];
  const periodos: PeriodoRapido[] = [
    "HOJE",
    "ONTEM",
    "7_DIAS",
    "30_DIAS",
    "VITALICIO",
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border">
        {/* Toolbar: abas + chips de período (limpos, como no mockup) */}
        <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-sm">
            {abas.map((a) => {
              const ativo = aba === a;
              const mostrarContador =
                a === "VENCIDA" && !!totais && totais.qtdVencidas > 0;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAba(a)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition",
                    ativo
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {abaLabel[a]}
                  {mostrarContador && (
                    <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive">
                      {totais.qtdVencidas}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              Vencimento
            </div>
            <div className="inline-flex w-fit gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-xs">
              {periodos.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriodo(p)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition",
                    periodo === p
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {periodoLabel[p]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-4">
            <DataTableSkeleton rows={5} columns={6} />
          </div>
        ) : (
        <div className="overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[130px] pl-5">Vencimento</TableHead>
              <TableHead>Descrição / Fornecedor</TableHead>
              <TableHead className="w-[160px]">Categoria</TableHead>
              <TableHead className="w-[140px] text-right">Valor</TableHead>
              <TableHead className="w-[100px] pr-5 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contas.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  nenhuma conta{aba !== "TODAS" ? ` ${abaLabel[aba].toLowerCase()}` : ""}
                  {periodo !== "VITALICIO"
                    ? ` com vencimento em ${periodoLabel[periodo].toLowerCase()}`
                    : ""}
                </TableCell>
              </TableRow>
            )}
            {contas.map((c) => (
              <TableRow key={c.id} className="hover:bg-muted/30">
                <TableCell
                  className={cn(
                    "whitespace-nowrap py-4 pl-5 text-sm",
                    c.status === StatusConta.VENCIDA
                      ? "text-destructive font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        corDotStatus(c.status),
                      )}
                    />
                    <span className="sr-only">{rotuloStatus(c.status)}</span>
                    {formatData(c.vencimento)}
                  </div>
                </TableCell>
                <TableCell className="py-4">
                  <div className="font-medium">{c.descricao}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {c.fornecedor.nome}
                    {c.recorrencia === "MENSAL" && (
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                        mensal
                      </span>
                    )}
                    {c.contaFixaId && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        fixa
                      </span>
                    )}
                    {c.nfNome && (
                      <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        NF
                      </span>
                    )}
                    {c.dossieFinanceiro?.documentos.length ? (
                      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        {c.dossieFinanceiro.documentos.length} doc
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="py-4 text-sm text-muted-foreground">
                  {c.categoria.nome}
                </TableCell>
                <TableCell className="py-4 text-right font-mono text-sm tabular-nums">
                  {formatBRL(c.valor)}
                </TableCell>
                <TableCell className="py-4 pr-5">
                  <div className="flex items-center justify-end gap-1">
                    {(c.status === StatusConta.ABERTA ||
                      c.status === StatusConta.VENCIDA) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Marcar como paga"
                        onClick={() => {
                          setPagoEm(hojeISO());
                          setContaParaPagar(c);
                        }}
                        className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                    )}
                    {c.status === StatusConta.PAGA && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Reverter pagamento"
                        disabled={reverter.isPending}
                        onClick={() => reverter.mutate(c.id)}
                        className="text-warning hover:bg-warning/10"
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover conta"
                      onClick={() => remover.mutate(c.id)}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        )}
      </div>

      {/* Dialog confirmar pagamento */}
      <Dialog
        open={!!contaParaPagar}
        onOpenChange={(v) => { if (!v) setContaParaPagar(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
          </DialogHeader>
          {contaParaPagar && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div className="font-medium">{contaParaPagar.descricao}</div>
                <div className="text-muted-foreground">{contaParaPagar.fornecedor.nome}</div>
                <div className="font-mono font-semibold text-base">
                  {formatBRL(contaParaPagar.valor)}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pagoEm">Data do pagamento</Label>
                <Input
                  id="pagoEm"
                  type="date"
                  value={pagoEm}
                  onChange={(e) => setPagoEm(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Uma saída de caixa será gerada automaticamente com essa data.
                {contaParaPagar.recorrencia === "MENSAL" &&
                  " A próxima parcela mensal será criada em seguida."}
              </p>
            </div>
          )}
          {pagar.isError && (
            <p className="text-sm text-destructive">
              {(pagar.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setContaParaPagar(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={pagar.isPending}
              onClick={() => {
                if (contaParaPagar) {
                  pagar.mutate({ id: contaParaPagar.id, pagoEm });
                }
              }}
            >
              {pagar.isPending ? "Registrando..." : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
