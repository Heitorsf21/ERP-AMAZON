"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Inbox,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { DialogTarefa, type TarefaEditavel } from "./dialog-tarefa";
import { DialogContasFixas } from "./dialog-contas-fixas";

type AgendaItem = {
  tipo: "TAREFA" | "CONTA_FIXA";
  id: string;
  titulo: string;
  descricao: string | null;
  data: string | null;
  dia: string | null;
  status: string;
  statusAgenda: "ABERTA" | "VENCIDA" | "CONCLUIDA" | "CANCELADA";
  vencida: boolean;
  visibilidade: string | null;
  responsavel: { id: string; nome: string } | null;
  valorCentavos: number | null;
  contaFixaId: string | null;
  competencia: string | null;
  fornecedor: { id: string; nome: string } | null;
  categoria: { id: string; nome: string } | null;
};

type AgendaResposta = { itens: AgendaItem[] };

const TIPOS: Array<{ key: string; label: string }> = [
  { key: "TAREFA_EMPRESA", label: "Empresa" },
  { key: "TAREFA_PESSOAL", label: "Pessoais" },
  { key: "TAREFA_MINHAS", label: "Minhas" },
  { key: "CONTA_FIXA", label: "Contas fixas" },
];

const STATUS: Array<{ key: string; label: string }> = [
  { key: "ABERTA", label: "Abertas" },
  { key: "VENCIDA", label: "Vencidas" },
  { key: "CONCLUIDA", label: "Concluídas" },
];

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diasNoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const STATUS_STYLE: Record<string, string> = {
  ABERTA: "text-blue-600 dark:text-blue-400",
  VENCIDA: "text-red-600 dark:text-red-400",
  CONCLUIDA: "text-emerald-600 dark:text-emerald-400",
  CANCELADA: "text-muted-foreground line-through",
};

export function AgendaView() {
  const qc = useQueryClient();
  const hoje = React.useMemo(() => hojeSP(), []);
  const [ano, setAno] = React.useState(() => Number(hoje.slice(0, 4)));
  const [mes, setMes] = React.useState(() => Number(hoje.slice(5, 7)));
  const [diaSelecionado, setDiaSelecionado] = React.useState<string>(hoje);
  const [tipos, setTipos] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<string[]>([]);

  const [novaTarefa, setNovaTarefa] = React.useState(false);
  const [tarefaEdit, setTarefaEdit] = React.useState<TarefaEditavel | null>(null);
  const [prazoInicial, setPrazoInicial] = React.useState<string | null>(null);
  const [gestaoContas, setGestaoContas] = React.useState(false);
  const [pagarItem, setPagarItem] = React.useState<AgendaItem | null>(null);
  const [pagoEm, setPagoEm] = React.useState<string>(hoje);

  const ultimoDia = diasNoMes(ano, mes);
  const de = `${ano}-${pad2(mes)}-01`;
  const ate = `${ano}-${pad2(mes)}-${pad2(ultimoDia)}`;

  const tiposCsv = tipos.join(",");
  const statusCsv = status.join(",");

  const { data, isLoading } = useQuery<AgendaResposta>({
    queryKey: ["agenda", de, ate, tiposCsv, statusCsv],
    queryFn: () => {
      const params = new URLSearchParams({ de, ate });
      if (tiposCsv) params.set("tipos", tiposCsv);
      if (statusCsv) params.set("status", statusCsv);
      return fetchJSON<AgendaResposta>(`/api/agenda?${params.toString()}`);
    },
  });

  const itens = React.useMemo(() => data?.itens ?? [], [data]);

  const porDia = React.useMemo(() => {
    const mapa = new Map<string, AgendaItem[]>();
    for (const item of itens) {
      if (!item.dia) continue;
      mapa.set(item.dia, [...(mapa.get(item.dia) ?? []), item]);
    }
    return mapa;
  }, [itens]);

  const backlog = React.useMemo(
    () => itens.filter((i) => i.dia == null),
    [itens],
  );

  const itensDoDia = porDia.get(diaSelecionado) ?? [];

  function irParaMes(novoAno: number, novoMes: number) {
    setAno(novoAno);
    setMes(novoMes);
    const mesAtual = hoje.slice(0, 7) === `${novoAno}-${pad2(novoMes)}`;
    setDiaSelecionado(mesAtual ? hoje : `${novoAno}-${pad2(novoMes)}-01`);
  }

  function mesAnterior() {
    if (mes === 1) irParaMes(ano - 1, 12);
    else irParaMes(ano, mes - 1);
  }
  function mesSeguinte() {
    if (mes === 12) irParaMes(ano + 1, 1);
    else irParaMes(ano, mes + 1);
  }

  function toggle(lista: string[], set: (v: string[]) => void, key: string) {
    set(lista.includes(key) ? lista.filter((k) => k !== key) : [...lista, key]);
  }

  const concluir = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/tarefas/${id}/concluir`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda"] }),
  });
  const reabrir = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/tarefas/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ABERTA" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda"] }),
  });
  const excluir = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/tarefas/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda"] }),
  });
  const pagar = useMutation({
    mutationFn: ({ id, data }: { id: string; data: string }) =>
      fetchJSON(`/api/contas/${id}/pagar`, {
        method: "POST",
        body: JSON.stringify({ pagoEm: data }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda"] });
      qc.invalidateQueries({ queryKey: ["contas"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      setPagarItem(null);
    },
  });

  // Grade do calendário: blanks iniciais + dias do mês.
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
  const celulas: Array<number | null> = [
    ...Array.from({ length: primeiroDiaSemana }, () => null),
    ...Array.from({ length: ultimoDia }, (_, i) => i + 1),
  ];

  const tituloDiaSel = formatarDiaLongo(diaSelecionado);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda"
        description="Tarefas da empresa, pessoais e contas fixas em um só lugar."
      >
        <Button variant="outline" onClick={() => setGestaoContas(true)}>
          <Wallet className="mr-2 h-4 w-4" />
          Contas fixas
        </Button>
        <Button
          onClick={() => {
            setTarefaEdit(null);
            setPrazoInicial(diaSelecionado);
            setNovaTarefa(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Nova tarefa
        </Button>
      </PageHeader>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Mostrar
        </span>
        {TIPOS.map((t) => (
          <ChipFiltro
            key={t.key}
            label={t.label}
            ativo={tipos.includes(t.key)}
            onClick={() => toggle(tipos, setTipos, t.key)}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {STATUS.map((s) => (
          <ChipFiltro
            key={s.key}
            label={s.label}
            ativo={status.includes(s.key)}
            onClick={() => toggle(status, setStatus, s.key)}
          />
        ))}
        {(tipos.length > 0 || status.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setTipos([]);
              setStatus([]);
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Limpar
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Calendário */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {MESES[mes - 1]} {ano}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => irParaMes(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)))}
              >
                Hoje
              </Button>
              <Button variant="ghost" size="icon" onClick={mesAnterior} aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={mesSeguinte} aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {celulas.map((dia, idx) => {
              if (dia == null) return <div key={`b${idx}`} />;
              const iso = `${ano}-${pad2(mes)}-${pad2(dia)}`;
              const itensDia = porDia.get(iso) ?? [];
              const temVencida = itensDia.some((i) => i.statusAgenda === "VENCIDA");
              const ehHoje = iso === hoje;
              const selecionado = iso === diaSelecionado;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setDiaSelecionado(iso)}
                  className={cn(
                    "flex min-h-[64px] flex-col rounded-md border p-1.5 text-left transition-colors",
                    selecionado
                      ? "border-primary ring-1 ring-primary"
                      : "border-transparent hover:border-border",
                    ehHoje ? "bg-primary/5" : "bg-muted/30",
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium",
                      ehHoje ? "text-primary" : "text-foreground",
                    )}
                  >
                    {dia}
                  </span>
                  {itensDia.length > 0 && (
                    <span className="mt-auto flex items-center gap-1">
                      <span
                        className={cn(
                          "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                          temVencida
                            ? "bg-red-500 text-white"
                            : "bg-primary/15 text-primary",
                        )}
                      >
                        {itensDia.length}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista do dia + backlog */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold capitalize">{tituloDiaSel}</h3>
            <div className="mt-3 space-y-2">
              {isLoading && (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}
              {!isLoading && itensDoDia.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nada agendado para este dia.
                </p>
              )}
              {itensDoDia.map((item) => (
                <ItemAgenda
                  key={`${item.tipo}-${item.id}`}
                  item={item}
                  onConcluir={() => concluir.mutate(item.id)}
                  onReabrir={() => reabrir.mutate(item.id)}
                  onEditar={() => {
                    setTarefaEdit(itemParaTarefa(item));
                    setNovaTarefa(true);
                  }}
                  onExcluir={() => excluir.mutate(item.id)}
                  onPagar={() => {
                    setPagoEm(hoje);
                    setPagarItem(item);
                  }}
                />
              ))}
            </div>
          </div>

          {backlog.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Inbox className="h-4 w-4 text-muted-foreground" />
                Sem prazo ({backlog.length})
              </h3>
              <div className="mt-3 space-y-2">
                {backlog.map((item) => (
                  <ItemAgenda
                    key={`${item.tipo}-${item.id}`}
                    item={item}
                    onConcluir={() => concluir.mutate(item.id)}
                    onReabrir={() => reabrir.mutate(item.id)}
                    onEditar={() => {
                      setTarefaEdit(itemParaTarefa(item));
                      setNovaTarefa(true);
                    }}
                    onExcluir={() => excluir.mutate(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <DialogTarefa
        aberto={novaTarefa}
        onOpenChange={(v) => {
          setNovaTarefa(v);
          if (!v) setTarefaEdit(null);
        }}
        tarefa={tarefaEdit}
        prazoInicial={prazoInicial}
      />
      <DialogContasFixas aberto={gestaoContas} onOpenChange={setGestaoContas} />

      <Dialog
        open={!!pagarItem}
        onOpenChange={(v) => {
          if (!v) setPagarItem(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar pagamento</DialogTitle>
          </DialogHeader>
          {pagarItem && (
            <div className="space-y-4">
              <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{pagarItem.titulo}</div>
                {pagarItem.valorCentavos != null && (
                  <div className="font-mono text-base font-semibold">
                    {formatBRL(pagarItem.valorCentavos)}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agenda-pagoEm">Data do pagamento</Label>
                <Input
                  id="agenda-pagoEm"
                  type="date"
                  value={pagoEm}
                  onChange={(e) => setPagoEm(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Uma saída de caixa será gerada automaticamente com essa data.
              </p>
              {pagar.isError && (
                <p className="text-sm text-destructive">
                  {(pagar.error as Error).message}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagarItem(null)}>
              Cancelar
            </Button>
            <Button
              disabled={pagar.isPending}
              onClick={() => {
                if (pagarItem) pagar.mutate({ id: pagarItem.id, data: pagoEm });
              }}
            >
              {pagar.isPending ? "Registrando…" : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChipFiltro({
  label,
  ativo,
  onClick,
}: {
  label: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        ativo
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function ItemAgenda({
  item,
  onConcluir,
  onReabrir,
  onEditar,
  onExcluir,
  onPagar,
}: {
  item: AgendaItem;
  onConcluir: () => void;
  onReabrir: () => void;
  onEditar: () => void;
  onExcluir: () => void;
  onPagar?: () => void;
}) {
  const ehTarefa = item.tipo === "TAREFA";
  const concluida = item.statusAgenda === "CONCLUIDA";

  return (
    <div className="flex items-start gap-2 rounded-md border p-2.5">
      {ehTarefa ? (
        <button
          type="button"
          onClick={concluida ? onReabrir : onConcluir}
          aria-label={concluida ? "Reabrir" : "Concluir"}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
            concluida
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-muted-foreground/40 hover:border-primary",
          )}
        >
          {concluida && <Check className="h-3 w-3" />}
        </button>
      ) : (
        <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm font-medium",
              concluida && "text-muted-foreground line-through",
            )}
          >
            {item.titulo}
          </span>
          {ehTarefa && item.visibilidade === "PESSOAL" && (
            <Badge variant="outline">pessoal</Badge>
          )}
          {!ehTarefa && <Badge variant="outline">conta fixa</Badge>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs">
          <span className={cn("flex items-center gap-1", STATUS_STYLE[item.statusAgenda])}>
            <CircleDot className="h-3 w-3" />
            {rotuloStatus(item.statusAgenda)}
          </span>
          {item.valorCentavos != null && (
            <span className="font-medium text-foreground">
              {formatBRL(item.valorCentavos)}
            </span>
          )}
          {item.descricao && (
            <span className="truncate text-muted-foreground">· {item.descricao}</span>
          )}
        </div>
      </div>

      {ehTarefa && (
        <div className="flex shrink-0 gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEditar}
            aria-label="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {concluida ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onReabrir}
              aria-label="Reabrir"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onExcluir}
            aria-label="Excluir"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {!ehTarefa && !concluida && onPagar && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950"
          onClick={onPagar}
          aria-label="Marcar como paga"
          title="Marcar como paga"
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function rotuloStatus(status: string): string {
  switch (status) {
    case "ABERTA":
      return "Aberta";
    case "VENCIDA":
      return "Vencida";
    case "CONCLUIDA":
      return "Concluída";
    case "CANCELADA":
      return "Cancelada";
    default:
      return status;
  }
}

function itemParaTarefa(item: AgendaItem): TarefaEditavel {
  return {
    id: item.id,
    titulo: item.titulo,
    descricao: item.descricao,
    prazo: item.data,
    visibilidade: item.visibilidade ?? "EMPRESA",
    status: item.status,
  };
}

function formatarDiaLongo(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a!, m! - 1, d!);
  return data.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}
