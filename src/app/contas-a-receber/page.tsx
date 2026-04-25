"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Upload, X, ChevronDown, ChevronRight, TrendingDown, Clock, ArrowDownToLine, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type ContaReceber = {
  id: string;
  descricao: string;
  valor: number;
  dataPrevisao: string | null;
  dataRecebimento: string | null;
  status: string;
  origem: string;
  liquidacaoId: string | null;
  totalPedidos: number;
  createdAt: string;
};

type Totais = {
  totalPendenteCentavos: number;
  quantidadePendente: number;
  totalRecebidaCentavos: number;
  quantidadeRecebida: number;
  totalCentavos: number;
};

type ResumoImportacao = {
  periodo: string;
  totalTransacoes: number;
  pedidos: { quantidade: number; totalCentavos: number };
  transferencias: { quantidade: number; totalCentavos: number };
  reembolsos: { quantidade: number; totalCentavos: number };
  taxas: { quantidade: number; totalCentavos: number };
  diferidos: { quantidade: number; totalCentavos: number };
};

type Composicao = {
  liquidacaoId: string;
  totalPedidos: number;
  totalReembolsos: number;
  receitaBrutaCentavos: number;
  taxasMarketplaceCentavos: number;
  fretesFBACentavos: number;
  reembolsosCentavos: number;
  taxasReembolsoCentavos: number;
  liquidoCalculadoCentavos: number;
  valorRegistradoCentavos: number;
  divergenciaCentavos: number;
};

type Aba = "PENDENTE" | "RECEBIDA" | "TODAS";

function formatData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "RECEBIDA")
    return <Badge variant="success">Recebida</Badge>;
  if (status === "CANCELADA")
    return <Badge variant="outline">Cancelada</Badge>;
  return <Badge variant="warning">Pendente</Badge>;
}

function LinhaComposicao({
  label,
  valorCentavos,
  tipo,
}: {
  label: string;
  valorCentavos: number;
  tipo: "receita" | "deducao" | "resultado" | "info";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-1 text-sm",
        tipo === "resultado" && "border-t border-dashed font-semibold mt-1 pt-2",
        tipo === "info" && "text-muted-foreground text-xs",
      )}
    >
      <span className={cn(tipo === "deducao" && "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums font-mono",
          tipo === "receita" && "text-foreground",
          tipo === "deducao" && "text-red-600 dark:text-red-400",
          tipo === "resultado" && valorCentavos >= 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
        )}
      >
        {tipo === "deducao" && valorCentavos > 0 ? "-" : ""}
        {formatBRL(Math.abs(valorCentavos))}
      </span>
    </div>
  );
}

function PainelComposicao({ contaId }: { contaId: string }) {
  const { data, isLoading, isError } = useQuery<Composicao>({
    queryKey: ["composicao-liquidacao", contaId],
    queryFn: () => fetchJSON<Composicao>(`/api/contas-a-receber/${contaId}/composicao`),
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground animate-pulse">
        Carregando composição…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Dados de composição não disponíveis para esta liquidação.
      </div>
    );
  }

  const divergencia = data.divergenciaCentavos;
  const temDivergencia = Math.abs(divergencia) > 100; // > R$ 1,00

  return (
    <div className="bg-muted/20 border-t px-6 py-4">
      <div className="max-w-sm">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Composição da Liquidação — {data.totalPedidos} pedido(s)
          {data.totalReembolsos > 0 && ` · ${data.totalReembolsos} reembolso(s)`}
        </p>

        <LinhaComposicao
          label="Receita bruta dos pedidos"
          valorCentavos={data.receitaBrutaCentavos}
          tipo="receita"
        />
        {data.taxasMarketplaceCentavos > 0 && (
          <LinhaComposicao
            label="(−) Taxas Amazon / Referral"
            valorCentavos={data.taxasMarketplaceCentavos}
            tipo="deducao"
          />
        )}
        {data.fretesFBACentavos > 0 && (
          <LinhaComposicao
            label="(−) Fretes / Taxas FBA"
            valorCentavos={data.fretesFBACentavos}
            tipo="deducao"
          />
        )}
        {data.reembolsosCentavos > 0 && (
          <LinhaComposicao
            label={`(−) Reembolsos${data.taxasReembolsoCentavos > 0 ? " (bruto)" : ""}`}
            valorCentavos={data.reembolsosCentavos}
            tipo="deducao"
          />
        )}
        {data.taxasReembolsoCentavos > 0 && (
          <LinhaComposicao
            label="(+) Taxas devolvidas (reembolso)"
            valorCentavos={-data.taxasReembolsoCentavos}
            tipo="deducao"
          />
        )}

        <LinhaComposicao
          label="= Líquido calculado"
          valorCentavos={data.liquidoCalculadoCentavos}
          tipo="resultado"
        />

        <LinhaComposicao
          label="Valor registrado no ERP"
          valorCentavos={data.valorRegistradoCentavos}
          tipo="info"
        />

        {temDivergencia && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
            <TrendingDown className="h-3.5 w-3.5 shrink-0" />
            Divergência de {formatBRL(Math.abs(divergencia))} entre cálculo e valor registrado.
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContasAReceberPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [aba, setAba] = useState<Aba>("PENDENTE");
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const statusParam = aba === "TODAS" ? "" : aba;

  const { data: totais } = useQuery<Totais>({
    queryKey: ["contas-a-receber-totais"],
    queryFn: () => fetchJSON<Totais>("/api/contas-a-receber/totais"),
  });

  const { data: contas = [], isLoading } = useQuery<ContaReceber[]>({
    queryKey: ["contas-a-receber", aba],
    queryFn: () =>
      fetchJSON<ContaReceber[]>(
        `/api/contas-a-receber${statusParam ? `?status=${statusParam}` : ""}`,
      ),
  });

  const importar = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("arquivo", file);
      const r = await fetch("/api/contas-a-receber/importar-amazon", {
        method: "POST",
        body: form,
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.erro ?? "erro na importação");
      }
      return r.json() as Promise<ResumoImportacao>;
    },
    onSuccess: (data) => {
      setResumo(data);
      qc.invalidateQueries({ queryKey: ["contas-a-receber"] });
      qc.invalidateQueries({ queryKey: ["contas-a-receber-totais"] });
      toast.success("CSV importado com sucesso");
    },
    onError: (err) => {
      toast.error((err as Error).message ?? "Erro na importação");
    },
  });

  const marcarRecebida = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/contas-a-receber/${id}/marcar-recebida`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas-a-receber"] });
      qc.invalidateQueries({ queryKey: ["contas-a-receber-totais"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      toast.success("Liquidação marcada como recebida");
    },
    onError: () => toast.error("Erro ao marcar como recebida"),
  });

  function toggleExpand(id: string) {
    setExpandidoId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas a Receber"
        description="Recebíveis da Amazon — importe o relatório Unified Transaction para atualizar."
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              importar.mutate(file);
              e.target.value = "";
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={importar.isPending}
          className="gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          {importar.isPending ? "Importando…" : "Importar CSV"}
        </Button>
      </PageHeader>

      {/* Resumo da importação — alert sutil */}
      {resumo && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">
                <span className="font-medium">Importação OK</span>
                <span className="text-muted-foreground"> — {resumo.periodo}: </span>
                {resumo.totalTransacoes} txns, {resumo.pedidos.quantidade} pedidos,{" "}
                <span className="text-warning font-medium">{resumo.diferidos.quantidade} diferidos</span>
              </span>
            </div>
            <details className="group shrink-0">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
                detalhes
              </summary>
              <div className="absolute right-4 mt-2 w-72 rounded-lg border bg-popover p-3 text-xs shadow-md">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>
                    <span className="text-muted-foreground">Pedidos:</span>{" "}
                    {formatBRL(resumo.pedidos.totalCentavos)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Transf.:</span>{" "}
                    {formatBRL(resumo.transferencias.totalCentavos)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reembolsos:</span>{" "}
                    {formatBRL(resumo.reembolsos.totalCentavos)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Taxas:</span>{" "}
                    {formatBRL(resumo.taxas.totalCentavos)}
                  </div>
                  <div className="col-span-2 text-warning">
                    <span className="text-muted-foreground">Diferidos:</span>{" "}
                    {formatBRL(resumo.diferidos.totalCentavos)}
                  </div>
                </div>
              </div>
            </details>
            <button
              type="button"
              onClick={() => setResumo(null)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Fechar resumo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="A receber"
          color="orange"
          icon={Clock}
          value={totais ? formatBRL(totais.totalPendenteCentavos) : "—"}
          sub={
            totais
              ? `${totais.quantidadePendente} liquidação${totais.quantidadePendente !== 1 ? "ões" : ""}`
              : undefined
          }
        />
        <KpiCard
          label="Já recebido"
          color="green"
          icon={CheckCircle2}
          value={totais ? formatBRL(totais.totalRecebidaCentavos) : "—"}
          sub={
            totais
              ? `${totais.quantidadeRecebida} liquidação${totais.quantidadeRecebida !== 1 ? "ões" : ""}`
              : undefined
          }
        />
        <KpiCard
          label="Total Amazon"
          color="blue"
          icon={ArrowDownToLine}
          value={totais ? formatBRL(totais.totalCentavos) : "—"}
          sub={
            totais
              ? `${totais.quantidadePendente + totais.quantidadeRecebida} liquidações`
              : undefined
          }
        />
      </div>

      {/* Tabs */}
      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList>
          <TabsTrigger value="PENDENTE">Pendentes</TabsTrigger>
          <TabsTrigger value="RECEBIDA">Recebidas</TabsTrigger>
          <TabsTrigger value="TODAS">Todas</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Tabela */}
      <div className="rounded-xl border">
        {isLoading ? (
          <div className="p-4">
            <DataTableSkeleton rows={5} columns={6} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[32px]" />
                <TableHead className="w-[160px]">Liquidação</TableHead>
                <TableHead className="w-[80px] text-right">Pedidos</TableHead>
                <TableHead className="w-[140px] text-right">Valor líquido</TableHead>
                <TableHead className="w-[140px]">
                  {aba === "RECEBIDA" ? "Recebido em" : "Previsão"}
                </TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    Nenhuma conta {aba !== "TODAS" ? (aba === "PENDENTE" ? "pendente" : "recebida") : ""}.
                    {aba === "PENDENTE" && " Importe um relatório Amazon acima."}
                  </TableCell>
                </TableRow>
              )}
              {contas.map((c) => {
                const expandido = expandidoId === c.id;
                const temLiquidacao = !!c.liquidacaoId;
                return (
                  <>
                    <TableRow key={c.id} className={cn("even:bg-muted/30", expandido && "bg-muted/40")}>
                      <TableCell className="pl-3">
                        {temLiquidacao && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(c.id)}
                            className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={expandido ? "Fechar detalhes" : "Ver composição"}
                          >
                            {expandido ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.liquidacaoId ?? c.id.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {c.totalPedidos > 0 ? c.totalPedidos : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono font-semibold tabular-nums text-sm",
                          c.status === "PENDENTE"
                            ? "text-warning"
                            : "text-success",
                        )}
                      >
                        {formatBRL(c.valor)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.status === "RECEBIDA"
                          ? formatData(c.dataRecebimento)
                          : formatData(c.dataPrevisao)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        {c.status === "PENDENTE" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Marcar como recebida"
                            disabled={marcarRecebida.isPending}
                            onClick={() => marcarRecebida.mutate(c.id)}
                            className="text-success hover:bg-success/10"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandido && (
                      <TableRow key={`${c.id}-composicao`} className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0">
                          <PainelComposicao contaId={c.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
