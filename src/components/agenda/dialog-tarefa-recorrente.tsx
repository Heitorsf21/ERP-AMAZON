"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fetchJSON } from "@/lib/fetcher";
import { VisibilidadeTarefa } from "@/modules/shared/domain";

type Tipo = "DIARIA" | "SEMANAL" | "MENSAL" | "PERSONALIZADA";
type Termino = "NUNCA" | "DATA" | "N_VEZES";

const TIPOS: Array<{ value: Tipo; label: string }> = [
  { value: "DIARIA", label: "Diária" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "MENSAL", label: "Mensal" },
  { value: "PERSONALIZADA", label: "Personalizada" },
];

const DIAS = [
  { value: 0, label: "D" },
  { value: 1, label: "S" },
  { value: 2, label: "T" },
  { value: 3, label: "Q" },
  { value: 4, label: "Q" },
  { value: 5, label: "S" },
  { value: 6, label: "S" },
];

function hojeIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function DialogTarefaRecorrente({
  aberto,
  onOpenChange,
  prazoInicial,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  prazoInicial?: string | null;
}) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [visibilidade, setVisibilidade] = React.useState<string>(
    VisibilidadeTarefa.EMPRESA,
  );
  const [inicioEm, setInicioEm] = React.useState("");
  const [tipo, setTipo] = React.useState<Tipo>("SEMANAL");
  const [diasSemana, setDiasSemana] = React.useState<number[]>([]);
  const [diaMes, setDiaMes] = React.useState("1");
  const [intervalo, setIntervalo] = React.useState("1");
  const [unidade, setUnidade] = React.useState<"DIAS" | "SEMANAS">("DIAS");
  const [termino, setTermino] = React.useState<Termino>("NUNCA");
  const [terminoAte, setTerminoAte] = React.useState("");
  const [terminoMaxVezes, setTerminoMaxVezes] = React.useState("10");
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!aberto) return;
    const inicio = prazoInicial ?? hojeIso();
    setTitulo("");
    setDescricao("");
    setVisibilidade(VisibilidadeTarefa.EMPRESA);
    setInicioEm(inicio);
    setTipo("SEMANAL");
    setDiasSemana([new Date(`${inicio}T12:00:00Z`).getUTCDay()]);
    setDiaMes(String(Number(inicio.slice(8, 10)) || 1));
    setIntervalo("1");
    setUnidade("DIAS");
    setTermino("NUNCA");
    setTerminoAte(inicio);
    setTerminoMaxVezes("10");
    setErro(null);
  }, [aberto, prazoInicial]);

  function toggleDia(dia: number) {
    setDiasSemana((prev) =>
      prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia],
    );
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error("título obrigatório");
      if (tipo === "SEMANAL" && diasSemana.length === 0) {
        throw new Error("selecione ao menos um dia da semana");
      }
      const payload = {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        visibilidade,
        inicioEm,
        tipoRecorrencia: tipo,
        diasSemana: tipo === "SEMANAL" ? diasSemana : undefined,
        diaMes: tipo === "MENSAL" ? Number(diaMes) : undefined,
        intervalo: tipo === "PERSONALIZADA" ? Number(intervalo) : 1,
        unidadeIntervalo: tipo === "PERSONALIZADA" ? unidade : undefined,
        tipoTermino: termino,
        terminoAte: termino === "DATA" ? terminoAte : undefined,
        terminoMaxVezes:
          termino === "N_VEZES" ? Number(terminoMaxVezes) : undefined,
      };
      return fetchJSON("/api/tarefas-recorrentes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda"] });
      onOpenChange(false);
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "falha ao salvar"),
  });

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            Nova tarefa recorrente
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErro(null);
            mutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="rec-titulo">Título</Label>
            <Input
              id="rec-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              required
              placeholder="Ex: revisar lances, conferir estoque…"
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="rec-inicio">Início</Label>
              <Input
                id="rec-inicio"
                type="date"
                value={inicioEm}
                onChange={(e) => setInicioEm(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-visibilidade">Tipo</Label>
              <Select
                id="rec-visibilidade"
                value={visibilidade}
                onChange={(e) => setVisibilidade(e.target.value)}
              >
                <option value={VisibilidadeTarefa.EMPRESA}>Empresa</option>
                <option value={VisibilidadeTarefa.PESSOAL}>Pessoal</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Repetir</Label>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTipo(t.value)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                    tipo === t.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {tipo === "SEMANAL" && (
            <div className="space-y-1.5">
              <Label>Dias da semana</Label>
              <div className="flex gap-1.5">
                {DIAS.map((d, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDia(d.value)}
                    className={cn(
                      "h-8 w-8 rounded-md border text-xs font-medium transition-colors",
                      diasSemana.includes(d.value)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tipo === "MENSAL" && (
            <div className="space-y-1.5">
              <Label htmlFor="rec-diames">Dia do mês (1–31)</Label>
              <Input
                id="rec-diames"
                type="number"
                min={1}
                max={31}
                value={diaMes}
                onChange={(e) => setDiaMes(e.target.value)}
                className="w-28"
              />
              <p className="text-xs text-muted-foreground">
                Meses sem esse dia usam o último dia (ex: 31 em fevereiro).
              </p>
            </div>
          )}

          {tipo === "PERSONALIZADA" && (
            <div className="space-y-1.5">
              <Label>A cada</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={intervalo}
                  onChange={(e) => setIntervalo(e.target.value)}
                  className="w-24"
                />
                <Select
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value as "DIAS" | "SEMANAS")}
                  aria-label="Unidade"
                >
                  <option value="DIAS">dias</option>
                  <option value="SEMANAS">semanas</option>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Termina</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { value: "NUNCA", label: "Nunca" },
                  { value: "DATA", label: "Em uma data" },
                  { value: "N_VEZES", label: "Após N vezes" },
                ] as Array<{ value: Termino; label: string }>
              ).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTermino(t.value)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                    termino === t.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {termino === "DATA" && (
              <Input
                type="date"
                value={terminoAte}
                onChange={(e) => setTerminoAte(e.target.value)}
                className="mt-2 w-44"
              />
            )}
            {termino === "N_VEZES" && (
              <Input
                type="number"
                min={1}
                value={terminoMaxVezes}
                onChange={(e) => setTerminoMaxVezes(e.target.value)}
                className="mt-2 w-28"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-descricao">
              Descrição{" "}
              <span className="text-xs font-normal text-muted-foreground">opcional</span>
            </Label>
            <Textarea
              id="rec-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>

          {visibilidade === VisibilidadeTarefa.PESSOAL && (
            <p className="text-xs text-muted-foreground">
              Cada ocorrência é uma tarefa pessoal privada (só você visualiza).
            </p>
          )}

          {erro && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
              {erro}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Criar recorrência"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
