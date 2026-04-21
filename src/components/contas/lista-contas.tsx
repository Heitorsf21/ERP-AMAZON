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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  nfNome: string | null;
  fornecedor: { id: string; nome: string };
  categoria: { id: string; nome: string };
  dossieFinanceiro: {
    id: string;
    documentos: { id: string; tipo: string; nomeArquivo: string }[];
  } | null;
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

function badgeStatus(status: string) {
  switch (status) {
    case StatusConta.ABERTA:
      return <Badge variant="secondary">aberta</Badge>;
    case StatusConta.VENCIDA:
      return <Badge variant="destructive">vencida</Badge>;
    case StatusConta.PAGA:
      return <Badge variant="success">paga</Badge>;
    case StatusConta.CANCELADA:
      return <Badge variant="outline">cancelada</Badge>;
    default:
      return <Badge variant="outline">{status.toLowerCase()}</Badge>;
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
    onError: () => toast.error("Erro ao remover conta"),
  });

  const reverter = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/contas/${id}/reverter`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      toast.success("Pagamento revertido");
    },
    onError: () => toast.error("Erro ao reverter pagamento"),
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
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
          <TabsList>
            {abas.map((a) => (
              <TabsTrigger key={a} value={a}>{abaLabel[a]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            Vencimento
          </div>
          <div className="flex w-fit gap-1 rounded-lg border bg-muted/30 p-1">
            {periodos.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriodo(p)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
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

      <div className="rounded-xl border">
        {isLoading ? (
          <div className="p-4">
            <DataTableSkeleton rows={5} columns={6} />
          </div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Vencimento</TableHead>
              <TableHead>Descrição / Fornecedor</TableHead>
              <TableHead className="w-[160px]">Categoria</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[140px] text-right">Valor</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contas.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  nenhuma conta{aba !== "TODAS" ? ` ${abaLabel[aba].toLowerCase()}` : ""}
                  {periodo !== "VITALICIO"
                    ? ` com vencimento em ${periodoLabel[periodo].toLowerCase()}`
                    : ""}
                </TableCell>
              </TableRow>
            )}
            {contas.map((c) => (
              <TableRow key={c.id} className="even:bg-muted/30">
                <TableCell
                  className={cn(
                    "whitespace-nowrap text-sm",
                    c.status === StatusConta.VENCIDA
                      ? "text-destructive font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {formatData(c.vencimento)}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{c.descricao}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {c.fornecedor.nome}
                    {c.recorrencia === "MENSAL" && (
                      <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide">
                        mensal
                      </span>
                    )}
                    {c.nfNome && (
                      <span className="rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1 py-0.5 text-[10px]">
                        NF
                      </span>
                    )}
                    {c.dossieFinanceiro?.documentos.length ? (
                      <span className="rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-1 py-0.5 text-[10px]">
                        {c.dossieFinanceiro.documentos.length} doc
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{c.categoria.nome}</TableCell>
                <TableCell>{badgeStatus(c.status)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-sm">
                  {formatBRL(c.valor)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
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
