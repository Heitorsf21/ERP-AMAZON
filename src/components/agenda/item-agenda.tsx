"use client";

import {
  Check,
  CheckCircle2,
  CircleDot,
  Pencil,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";

export type AgendaItem = {
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

export const STATUS_STYLE: Record<string, string> = {
  ABERTA: "text-blue-600 dark:text-blue-400",
  VENCIDA: "text-red-600 dark:text-red-400",
  CONCLUIDA: "text-emerald-600 dark:text-emerald-400",
  CANCELADA: "text-muted-foreground line-through",
};

export function rotuloStatus(status: string): string {
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

export function ItemAgenda({
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
