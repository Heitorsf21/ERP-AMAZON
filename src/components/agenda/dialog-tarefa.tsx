"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare } from "lucide-react";
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
import { fetchJSON } from "@/lib/fetcher";
import { VisibilidadeTarefa } from "@/modules/shared/domain";

export type TarefaEditavel = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null; // ISO
  visibilidade: string;
  status: string;
};

export function DialogTarefa({
  aberto,
  onOpenChange,
  tarefa,
  prazoInicial,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  tarefa?: TarefaEditavel | null;
  prazoInicial?: string | null; // yyyy-MM-dd
}) {
  const qc = useQueryClient();
  const editando = Boolean(tarefa);

  const [titulo, setTitulo] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [prazo, setPrazo] = React.useState("");
  const [visibilidade, setVisibilidade] = React.useState<string>(
    VisibilidadeTarefa.EMPRESA,
  );
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!aberto) return;
    if (tarefa) {
      setTitulo(tarefa.titulo);
      setDescricao(tarefa.descricao ?? "");
      setPrazo(tarefa.prazo ? isoParaInputDate(tarefa.prazo) : "");
      setVisibilidade(tarefa.visibilidade);
    } else {
      setTitulo("");
      setDescricao("");
      setPrazo(prazoInicial ?? "");
      setVisibilidade(VisibilidadeTarefa.EMPRESA);
    }
    setErro(null);
  }, [aberto, tarefa, prazoInicial]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error("título obrigatório");
      const payload = {
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        prazo: prazo || null,
        visibilidade,
      };
      if (editando && tarefa) {
        return fetchJSON(`/api/tarefas/${tarefa.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return fetchJSON("/api/tarefas", {
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

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    mutation.mutate();
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5" />
            {editando ? "Editar tarefa" : "Nova tarefa"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submeter} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tarefa-titulo">Título</Label>
            <Input
              id="tarefa-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              required
              placeholder="Ex: pagar contador, ligar fornecedor…"
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-prazo">
                Prazo{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  opcional
                </span>
              </Label>
              <Input
                id="tarefa-prazo"
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-visibilidade">Tipo</Label>
              <Select
                id="tarefa-visibilidade"
                value={visibilidade}
                onChange={(e) => setVisibilidade(e.target.value)}
              >
                <option value={VisibilidadeTarefa.EMPRESA}>Empresa</option>
                <option value={VisibilidadeTarefa.PESSOAL}>Pessoal</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tarefa-descricao">
              Descrição{" "}
              <span className="text-xs font-normal text-muted-foreground">
                opcional
              </span>
            </Label>
            <Textarea
              id="tarefa-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Detalhes da tarefa"
            />
          </div>

          {visibilidade === VisibilidadeTarefa.PESSOAL && (
            <p className="text-xs text-muted-foreground">
              Tarefas pessoais são privadas: só você consegue visualizá-las.
            </p>
          )}

          {erro && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
              {erro}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function isoParaInputDate(iso: string): string {
  // Converte ISO (UTC, meio-dia) para yyyy-MM-dd no fuso de SP.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
