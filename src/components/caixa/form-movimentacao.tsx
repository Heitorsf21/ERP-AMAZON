"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseValorBRParaCentavos } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { TipoMovimentacao } from "@/modules/shared/domain";

type Categoria = { id: string; nome: string; tipo: string };
type Segmento = "ENTRADA" | "SAIDA" | "AJUSTE";
type DirecaoAjuste = "ENTRADA" | "SAIDA";

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FormMovimentacao({
  aberto,
  onOpenChange,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [segmento, setSegmento] = React.useState<Segmento>("ENTRADA");
  const [direcaoAjuste, setDirecaoAjuste] = React.useState<DirecaoAjuste>("ENTRADA");
  const [valor, setValor] = React.useState("");
  const [data, setData] = React.useState(hojeISO());
  const [categoriaId, setCategoriaId] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  const { data: categorias = [] } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: () => fetchJSON<Categoria[]>("/api/categorias"),
  });

  const tipoEfetivo: string =
    segmento === "AJUSTE" ? direcaoAjuste : segmento;

  const categoriasFiltradas = categorias.filter((c) => {
    if (c.tipo === "AMBAS") return true;
    if (tipoEfetivo === TipoMovimentacao.ENTRADA) return c.tipo === "RECEITA";
    return c.tipo === "DESPESA";
  });

  React.useEffect(() => {
    if (categoriaId && !categoriasFiltradas.some((c) => c.id === categoriaId)) {
      setCategoriaId("");
    }
  }, [tipoEfetivo, categoriaId, categoriasFiltradas]);

  const mutation = useMutation({
    mutationFn: async () => {
      const valorCentavos = parseValorBRParaCentavos(valor);
      if (valorCentavos <= 0) throw new Error("valor deve ser > 0");
      if (!categoriaId) throw new Error("selecione uma categoria");
      if (!descricao.trim()) throw new Error("descrição obrigatória");
      if (segmento === "AJUSTE" && motivo.trim().length < 3) {
        throw new Error("motivo do ajuste obrigatório (mínimo 3 caracteres)");
      }
      const payload = {
        tipo: tipoEfetivo,
        valorCentavos,
        dataCaixa: data,
        categoriaId,
        descricao: descricao.trim(),
        ...(segmento === "AJUSTE"
          ? { origem: "AJUSTE", motivoAjuste: motivo.trim() }
          : {}),
      };
      return fetchJSON("/api/movimentacoes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
      resetar();
      onOpenChange(false);
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "falha ao salvar"),
  });

  function resetar() {
    setSegmento("ENTRADA");
    setDirecaoAjuste("ENTRADA");
    setValor("");
    setData(hojeISO());
    setCategoriaId("");
    setDescricao("");
    setMotivo("");
    setErro(null);
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    mutation.mutate();
  }

  const ehAjuste = segmento === "AJUSTE";

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) resetar();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ehAjuste ? (
              <Scale className="h-5 w-5 text-amber-600" />
            ) : (
              <ArrowUpCircle className="h-5 w-5 text-primary" />
            )}
            {ehAjuste ? "Ajuste de saldo" : "Nova movimentação"}
          </DialogTitle>
        </DialogHeader>

        {ehAjuste && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            Use para reconciliar com o extrato bancário. O lançamento é
            registrado como <strong>AJUSTE</strong> com motivo auditável.
          </div>
        )}

        <form onSubmit={submeter} className="space-y-4">
          {/* Segmento principal: Entrada | Saída | Ajuste */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Tipo
            </Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-md border bg-muted/30 p-1">
              <BotaoSeg
                ativo={segmento === "ENTRADA"}
                onClick={() => setSegmento("ENTRADA")}
                cor="emerald"
                icone={<ArrowUpCircle className="h-4 w-4" />}
                label="Entrada"
              />
              <BotaoSeg
                ativo={segmento === "SAIDA"}
                onClick={() => setSegmento("SAIDA")}
                cor="rose"
                icone={<ArrowDownCircle className="h-4 w-4" />}
                label="Saída"
              />
              <BotaoSeg
                ativo={segmento === "AJUSTE"}
                onClick={() => setSegmento("AJUSTE")}
                cor="amber"
                icone={<Scale className="h-4 w-4" />}
                label="Ajuste"
              />
            </div>
          </div>

          {/* Sub-controle de direção — só exibido no modo Ajuste */}
          {ehAjuste && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Direção do ajuste
              </Label>
              <div className="grid grid-cols-2 gap-1.5 rounded-md border bg-muted/30 p-1">
                <BotaoSeg
                  ativo={direcaoAjuste === "ENTRADA"}
                  onClick={() => setDirecaoAjuste("ENTRADA")}
                  cor="emerald"
                  icone={<ArrowUpCircle className="h-4 w-4" />}
                  label="Aumentar saldo"
                />
                <BotaoSeg
                  ativo={direcaoAjuste === "SAIDA"}
                  onClick={() => setDirecaoAjuste("SAIDA")}
                  cor="rose"
                  icone={<ArrowDownCircle className="h-4 w-4" />}
                  label="Reduzir saldo"
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="valor">Valor (R$)</Label>
              <Input
                id="valor"
                placeholder="0,00"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
                className="font-mono text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="data">Data</Label>
              <Input
                id="data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="categoria">Categoria</Label>
            <Select
              id="categoria"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              required
            >
              <option value="">— selecione —</option>
              {categoriasFiltradas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="descricao">Descrição</Label>
            <Input
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
              maxLength={300}
              placeholder={
                ehAjuste
                  ? "Ex: ajuste após conferência do extrato Nubank"
                  : "Ex: pagamento boleto Lalamove"
              }
            />
          </div>

          {ehAjuste && (
            <div className="space-y-1.5">
              <Label htmlFor="motivo">
                Motivo do ajuste{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                required
                placeholder="Ex: taxa bancária não lançada em 05/04 — conferido no extrato"
                maxLength={500}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Fica registrado para auditoria — quem, quando, por quê.
              </p>
            </div>
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
              {mutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BotaoSeg({
  ativo,
  onClick,
  cor,
  icone,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  cor: "emerald" | "rose" | "amber";
  icone: React.ReactNode;
  label: string;
}) {
  const ativoCor =
    cor === "emerald"
      ? "bg-emerald-600 text-white shadow-sm"
      : cor === "rose"
        ? "bg-rose-600 text-white shadow-sm"
        : "bg-amber-500 text-white shadow-sm";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-xs font-medium transition",
        ativo
          ? ativoCor
          : "text-muted-foreground hover:bg-background hover:text-foreground",
      )}
    >
      {icone}
      {label}
    </button>
  );
}
