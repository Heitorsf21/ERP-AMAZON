"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Inbox, Plus, Repeat, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
import { DialogTarefaRecorrente } from "./dialog-tarefa-recorrente";
import { PainelAConcluir } from "./painel-a-concluir";
import { ItemAgenda, type AgendaItem } from "./item-agenda";

type AgendaResposta = { itens: AgendaItem[] };
type Modo = "dia" | "semana" | "mes";

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
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const MES_CURTO = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
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
function isoParaUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
function utcParaIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
function addDiasIso(iso: string, n: number): string {
  const dt = isoParaUTC(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcParaIso(dt);
}
function weekdayIso(iso: string): number {
  return isoParaUTC(iso).getUTCDay();
}
function inicioSemanaIso(iso: string): string {
  return addDiasIso(iso, -weekdayIso(iso));
}

export function AgendaView() {
  const qc = useQueryClient();
  const hoje = React.useMemo(() => hojeSP(), []);
  const [modo, setModo] = React.useState<Modo>("semana");
  const [cursor, setCursor] = React.useState<string>(hoje);
  const [tipos, setTipos] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<string[]>([]);

  const [novaTarefa, setNovaTarefa] = React.useState(false);
  const [tarefaEdit, setTarefaEdit] = React.useState<TarefaEditavel | null>(null);
  const [prazoInicial, setPrazoInicial] = React.useState<string | null>(null);
  const [novaRecorrente, setNovaRecorrente] = React.useState(false);
  const [gestaoContas, setGestaoContas] = React.useState(false);
  const [pagarItem, setPagarItem] = React.useState<AgendaItem | null>(null);
  const [pagoEm, setPagoEm] = React.useState<string>(hoje);

  // Intervalo do calendário conforme o modo.
  const anoCursor = Number(cursor.slice(0, 4));
  const mesCursor = Number(cursor.slice(5, 7));
  const inicioSemana = inicioSemanaIso(cursor);
  const { de, ate } =
    modo === "mes"
      ? {
          de: `${anoCursor}-${pad2(mesCursor)}-01`,
          ate: `${anoCursor}-${pad2(mesCursor)}-${pad2(diasNoMes(anoCursor, mesCursor))}`,
        }
      : modo === "semana"
        ? { de: inicioSemana, ate: addDiasIso(inicioSemana, 6) }
        : { de: cursor, ate: cursor };

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

  // Painel "A concluir": janela ampla (atrasadas até o fim desta semana) +
  // backlog. Independe do modo/cursor do calendário.
  const fimSemanaHoje = addDiasIso(inicioSemanaIso(hoje), 6);
  const dePainel = addDiasIso(hoje, -90);
  const { data: dataPainel } = useQuery<AgendaResposta>({
    queryKey: ["agenda", "a-concluir", dePainel, fimSemanaHoje, tiposCsv],
    queryFn: () => {
      const params = new URLSearchParams({
        de: dePainel,
        ate: fimSemanaHoje,
        status: "ABERTA,VENCIDA",
      });
      if (tiposCsv) params.set("tipos", tiposCsv);
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

  const concluir = useMutation({
    mutationFn: (id: string) => fetchJSON(`/api/tarefas/${id}/concluir`, { method: "POST" }),
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
    mutationFn: (id: string) => fetchJSON(`/api/tarefas/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda"] }),
  });
  const pagar = useMutation({
    mutationFn: ({ id, data: dataPagamento }: { id: string; data: string }) =>
      fetchJSON(`/api/contas/${id}/pagar`, {
        method: "POST",
        body: JSON.stringify({ pagoEm: dataPagamento }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda"] });
      qc.invalidateQueries({ queryKey: ["contas"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      setPagarItem(null);
    },
  });

  function abrirEdicao(item: AgendaItem) {
    setTarefaEdit(itemParaTarefa(item));
    setPrazoInicial(null);
    setNovaTarefa(true);
  }
  function abrirPagamento(item: AgendaItem) {
    setPagoEm(hoje);
    setPagarItem(item);
  }

  function navegar(delta: number) {
    if (modo === "mes") {
      const dt = new Date(Date.UTC(anoCursor, mesCursor - 1 + delta, 1));
      const ny = dt.getUTCFullYear();
      const nm = dt.getUTCMonth() + 1;
      const nd = Math.min(Number(cursor.slice(8, 10)), diasNoMes(ny, nm));
      setCursor(`${ny}-${pad2(nm)}-${pad2(nd)}`);
    } else {
      setCursor(addDiasIso(cursor, delta * (modo === "semana" ? 7 : 1)));
    }
  }

  function toggle(lista: string[], set: (v: string[]) => void, key: string) {
    set(lista.includes(key) ? lista.filter((k) => k !== key) : [...lista, key]);
  }

  const titulo =
    modo === "mes"
      ? `${MESES[mesCursor - 1]} ${anoCursor}`
      : modo === "semana"
        ? `${pad2(Number(inicioSemana.slice(8, 10)))} – ${pad2(Number(addDiasIso(inicioSemana, 6).slice(8, 10)))} ${MES_CURTO[Number(addDiasIso(inicioSemana, 6).slice(5, 7)) - 1]}`
        : formatarDiaLongo(cursor);

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
          variant="outline"
          onClick={() => {
            setPrazoInicial(cursor);
            setNovaRecorrente(true);
          }}
        >
          <Repeat className="mr-2 h-4 w-4" />
          Recorrente
        </Button>
        <Button
          onClick={() => {
            setTarefaEdit(null);
            setPrazoInicial(cursor);
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
        {/* Calendário (peça principal) */}
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold capitalize">{titulo}</h2>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border p-0.5">
                {(["dia", "semana", "mes"] as Modo[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModo(m)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                      modo === m
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {m === "mes" ? "Mês" : m}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => setCursor(hoje)}>
                Hoje
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navegar(-1)} aria-label="Anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => navegar(1)} aria-label="Próximo">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {modo === "mes" && (
            <VisaoMes
              ano={anoCursor}
              mes={mesCursor}
              hoje={hoje}
              porDia={porDia}
              onSelecionarDia={(iso) => {
                setCursor(iso);
                setModo("dia");
              }}
            />
          )}
          {modo === "semana" && (
            <VisaoSemana
              inicioSemana={inicioSemana}
              hoje={hoje}
              porDia={porDia}
              onSelecionarDia={(iso) => {
                setCursor(iso);
                setModo("dia");
              }}
            />
          )}
          {modo === "dia" && (
            <VisaoDia
              dia={cursor}
              itens={porDia.get(cursor) ?? []}
              isLoading={isLoading}
              onConcluir={(item) => concluir.mutate(item.id)}
              onReabrir={(item) => reabrir.mutate(item.id)}
              onEditar={abrirEdicao}
              onExcluir={(item) => excluir.mutate(item.id)}
              onPagar={abrirPagamento}
            />
          )}
        </div>

        {/* Painel "A concluir" (fixo) */}
        <PainelAConcluir
          items={dataPainel?.itens ?? []}
          hoje={hoje}
          fimSemana={fimSemanaHoje}
          onConcluir={(item) => concluir.mutate(item.id)}
          onReabrir={(item) => reabrir.mutate(item.id)}
          onEditar={abrirEdicao}
          onExcluir={(item) => excluir.mutate(item.id)}
          onPagar={abrirPagamento}
        />
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
      <DialogTarefaRecorrente
        aberto={novaRecorrente}
        onOpenChange={setNovaRecorrente}
        prazoInicial={prazoInicial}
      />
      <DialogContasFixas aberto={gestaoContas} onOpenChange={setGestaoContas} />

      <Dialog open={!!pagarItem} onOpenChange={(v) => { if (!v) setPagarItem(null); }}>
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
                <p className="text-sm text-destructive">{(pagar.error as Error).message}</p>
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

function VisaoMes({
  ano,
  mes,
  hoje,
  porDia,
  onSelecionarDia,
}: {
  ano: number;
  mes: number;
  hoje: string;
  porDia: Map<string, AgendaItem[]>;
  onSelecionarDia: (iso: string) => void;
}) {
  const ultimoDia = diasNoMes(ano, mes);
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
  const celulas: Array<number | null> = [
    ...Array.from({ length: primeiroDiaSemana }, () => null),
    ...Array.from({ length: ultimoDia }, (_, i) => i + 1),
  ];
  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {celulas.map((dia, idx) => {
          if (dia == null) return <div key={`b${idx}`} />;
          const iso = `${ano}-${pad2(mes)}-${pad2(dia)}`;
          const itensDia = porDia.get(iso) ?? [];
          const temVencida = itensDia.some((i) => i.statusAgenda === "VENCIDA");
          const ehHoje = iso === hoje;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelecionarDia(iso)}
              className={cn(
                "flex min-h-[64px] flex-col rounded-md border p-1.5 text-left transition-colors hover:border-primary",
                ehHoje ? "border-primary/60 bg-primary/5" : "border-transparent bg-muted/30",
              )}
            >
              <span className={cn("text-xs font-medium", ehHoje ? "text-primary" : "text-foreground")}>
                {dia}
              </span>
              {itensDia.length > 0 && (
                <span className="mt-auto flex items-center gap-1">
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                      temVencida ? "bg-red-500 text-white" : "bg-primary/15 text-primary",
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
    </>
  );
}

function VisaoSemana({
  inicioSemana,
  hoje,
  porDia,
  onSelecionarDia,
}: {
  inicioSemana: string;
  hoje: string;
  porDia: Map<string, AgendaItem[]>;
  onSelecionarDia: (iso: string) => void;
}) {
  const dias = Array.from({ length: 7 }, (_, i) => addDiasIso(inicioSemana, i));
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {dias.map((iso) => {
        const itensDia = porDia.get(iso) ?? [];
        const ehHoje = iso === hoje;
        const numeroDia = Number(iso.slice(8, 10));
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onSelecionarDia(iso)}
            className={cn(
              "flex min-h-[140px] flex-col rounded-md border p-1.5 text-left transition-colors hover:border-primary",
              ehHoje ? "border-primary/60 bg-primary/5" : "border-border bg-muted/20",
            )}
          >
            <div className="mb-1 text-center text-[10px] text-muted-foreground">
              {DIAS_SEMANA[weekdayIso(iso)]}
              <span className={cn("block text-sm font-semibold", ehHoje ? "text-primary" : "text-foreground")}>
                {numeroDia}
              </span>
            </div>
            <div className="space-y-1">
              {itensDia.slice(0, 4).map((item) => (
                <span
                  key={`${item.tipo}-${item.id}`}
                  className={cn(
                    "block truncate rounded px-1.5 py-1 text-[10px] leading-tight",
                    item.statusAgenda === "VENCIDA"
                      ? "bg-red-500/15 text-red-700 dark:text-red-300"
                      : item.statusAgenda === "CONCLUIDA"
                        ? "bg-emerald-500/15 text-emerald-700 line-through dark:text-emerald-300"
                        : "bg-primary/10 text-primary",
                  )}
                  title={item.titulo}
                >
                  {item.titulo}
                </span>
              ))}
              {itensDia.length > 4 && (
                <span className="block text-[10px] text-muted-foreground">
                  +{itensDia.length - 4}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function VisaoDia({
  dia,
  itens,
  isLoading,
  onConcluir,
  onReabrir,
  onEditar,
  onExcluir,
  onPagar,
}: {
  dia: string;
  itens: AgendaItem[];
  isLoading: boolean;
  onConcluir: (item: AgendaItem) => void;
  onReabrir: (item: AgendaItem) => void;
  onEditar: (item: AgendaItem) => void;
  onExcluir: (item: AgendaItem) => void;
  onPagar: (item: AgendaItem) => void;
}) {
  return (
    <div className="space-y-2">
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && itens.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Inbox className="h-6 w-6 opacity-40" />
          <p className="text-sm">Nada agendado para {formatarDiaLongo(dia)}.</p>
        </div>
      )}
      {itens.map((item) => (
        <ItemAgenda
          key={`${item.tipo}-${item.id}`}
          item={item}
          onConcluir={() => onConcluir(item)}
          onReabrir={() => onReabrir(item)}
          onEditar={() => onEditar(item)}
          onExcluir={() => onExcluir(item)}
          onPagar={() => onPagar(item)}
        />
      ))}
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
