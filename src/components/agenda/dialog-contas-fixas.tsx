"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pencil, Plus, Repeat, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL, parseValorBRParaCentavos } from "@/lib/money";

type Categoria = { id: string; nome: string; tipo: string };
type Fornecedor = { id: string; nome: string };

type ContaFixa = {
  id: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  recorrente: boolean;
  competenciaUnica: string | null;
  ativa: boolean;
  categoriaId: string | null;
  fornecedorId: string | null;
  observacoes: string | null;
  categoria: { id: string; nome: string } | null;
  fornecedor: { id: string; nome: string } | null;
};

const VAZIO = {
  id: null as string | null,
  descricao: "",
  valor: "",
  diaVencimento: "1",
  recorrente: true,
  vencimentoUnico: "",
  sincronizarFuturas: true,
  ativa: true,
  categoriaId: "",
  fornecedorId: "",
  observacoes: "",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function DialogContasFixas({
  aberto,
  onOpenChange,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ ...VAZIO });
  const [erro, setErro] = React.useState<string | null>(null);
  const [backfillDe, setBackfillDe] = React.useState("2025-08-25");

  const { data: contas = [], isLoading } = useQuery<ContaFixa[]>({
    queryKey: ["contas-fixas", "todas"],
    queryFn: () => fetchJSON<ContaFixa[]>("/api/contas-fixas?inativas=1"),
    enabled: aberto,
  });
  const { data: categorias = [] } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: () => fetchJSON<Categoria[]>("/api/categorias"),
    enabled: aberto,
  });
  const { data: fornecedores = [] } = useQuery<Fornecedor[]>({
    queryKey: ["fornecedores"],
    queryFn: () => fetchJSON<Fornecedor[]>("/api/fornecedores"),
    enabled: aberto,
  });

  const categoriasDespesa = categorias.filter(
    (c) => c.tipo === "DESPESA" || c.tipo === "AMBAS",
  );

  function invalidarTudo() {
    qc.invalidateQueries({ queryKey: ["contas-fixas"] });
    qc.invalidateQueries({ queryKey: ["agenda"] });
    qc.invalidateQueries({ queryKey: ["contas"] });
    qc.invalidateQueries({ queryKey: ["dashboard-ecommerce-kpis"] });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const valorCentavos = parseValorBRParaCentavos(form.valor);
      if (!form.descricao.trim()) throw new Error("descrição obrigatória");
      if (valorCentavos <= 0) throw new Error("valor deve ser > 0");

      let diaVencimento: number;
      if (form.recorrente) {
        diaVencimento = Number(form.diaVencimento);
        if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
          throw new Error("dia de vencimento deve estar entre 1 e 31");
        }
      } else {
        if (!form.vencimentoUnico) throw new Error("escolha a data de vencimento");
        diaVencimento = Number(form.vencimentoUnico.split("-")[2]);
      }

      const payload = {
        descricao: form.descricao.trim(),
        valorCentavos,
        diaVencimento,
        recorrente: form.recorrente,
        ...(form.recorrente ? {} : { vencimentoUnico: form.vencimentoUnico }),
        ativa: form.ativa,
        categoriaId: form.categoriaId || null,
        fornecedorId: form.fornecedorId || null,
        observacoes: form.observacoes.trim() || null,
        ...(form.id ? { sincronizarFuturas: form.sincronizarFuturas } : {}),
      };
      if (form.id) {
        return fetchJSON(`/api/contas-fixas/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      return fetchJSON("/api/contas-fixas", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      invalidarTudo();
      setForm({ ...VAZIO });
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "falha ao salvar"),
  });

  const desativar = useMutation({
    mutationFn: (id: string) =>
      fetchJSON(`/api/contas-fixas/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidarTudo();
      setForm((f) => ({ ...f, ...(f.id ? VAZIO : {}) }));
    },
  });

  const gerarHistorico = useMutation({
    mutationFn: () =>
      fetchJSON<{ criadas: number; pagas: number }>(
        "/api/contas-fixas/ocorrencias",
        {
          method: "POST",
          body: JSON.stringify({ de: backfillDe, ate: hojeISO() }),
        },
      ),
    onSuccess: (r) => {
      invalidarTudo();
      toast.success(
        `Histórico gerado: ${r.criadas} parcela(s), ${r.pagas} marcada(s) como paga(s).`,
      );
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "falha ao gerar histórico"),
  });

  function editar(conta: ContaFixa) {
    setErro(null);
    setForm({
      id: conta.id,
      descricao: conta.descricao,
      valor: (conta.valor / 100).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      diaVencimento: String(conta.diaVencimento),
      recorrente: conta.recorrente,
      vencimentoUnico:
        !conta.recorrente && conta.competenciaUnica
          ? `${conta.competenciaUnica}-${pad2(conta.diaVencimento)}`
          : "",
      sincronizarFuturas: true,
      ativa: conta.ativa,
      categoriaId: conta.categoriaId ?? "",
      fornecedorId: conta.fornecedorId ?? "",
      observacoes: conta.observacoes ?? "",
    });
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    salvar.mutate();
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Contas fixas
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Formulário */}
          <form onSubmit={submeter} className="space-y-3">
            <div className="text-sm font-medium">
              {form.id ? "Editar conta fixa" : "Nova conta fixa"}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-descricao">Descrição</Label>
              <Input
                id="cf-descricao"
                value={form.descricao}
                onChange={(e) =>
                  setForm((f) => ({ ...f, descricao: e.target.value }))
                }
                maxLength={300}
                required
                placeholder="Ex: aluguel, internet, contador…"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.recorrente}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recorrente: e.target.checked }))
                  }
                />
                Recorrente (todo mês)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.ativa}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ativa: e.target.checked }))
                  }
                />
                Ativa
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
              <div className="space-y-1.5">
                <Label htmlFor="cf-valor">Valor (R$)</Label>
                <Input
                  id="cf-valor"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.valor}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, valor: e.target.value }))
                  }
                  className="font-mono"
                  required
                />
              </div>
              {form.recorrente ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cf-dia">Dia do mês</Label>
                  <Input
                    id="cf-dia"
                    type="number"
                    min={1}
                    max={31}
                    value={form.diaVencimento}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, diaVencimento: e.target.value }))
                    }
                    required
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="cf-vencunico">Vencimento</Label>
                  <Input
                    id="cf-vencunico"
                    type="date"
                    value={form.vencimentoUnico}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, vencimentoUnico: e.target.value }))
                    }
                    required
                  />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {form.recorrente
                ? "Vence todo mês no dia informado (dias inexistentes caem no último dia do mês)."
                : "Lançamento único na data escolhida."}
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="cf-categoria">
                Categoria{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  opcional
                </span>
              </Label>
              <Select
                id="cf-categoria"
                value={form.categoriaId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, categoriaId: e.target.value }))
                }
              >
                <option value="">— nenhuma —</option>
                {categoriasDespesa.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-fornecedor">
                Fornecedor{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  opcional
                </span>
              </Label>
              <Select
                id="cf-fornecedor"
                value={form.fornecedorId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fornecedorId: e.target.value }))
                }
              >
                <option value="">— nenhum —</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </Select>
            </div>

            {form.id && (
              <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.sincronizarFuturas}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sincronizarFuturas: e.target.checked,
                    }))
                  }
                />
                <span>
                  Atualizar ocorrências futuras em aberto com o novo valor/data
                  <span className="block text-[11px] text-muted-foreground">
                    As ocorrências já pagas nunca são alteradas.
                  </span>
                </span>
              </label>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cf-obs">
                Observações{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  opcional
                </span>
              </Label>
              <Textarea
                id="cf-obs"
                rows={2}
                maxLength={500}
                value={form.observacoes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, observacoes: e.target.value }))
                }
              />
            </div>

            {erro && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
                {erro}
              </div>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={salvar.isPending} className="flex-1">
                {form.id ? (
                  <>
                    <Pencil className="mr-2 h-4 w-4" />
                    {salvar.isPending ? "Salvando…" : "Salvar alterações"}
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    {salvar.isPending ? "Salvando…" : "Adicionar"}
                  </>
                )}
              </Button>
              {form.id && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setErro(null);
                    setForm({ ...VAZIO });
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </form>

          {/* Lista */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Cadastradas</div>
            <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
              {isLoading && (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}
              {!isLoading && contas.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma conta fixa cadastrada ainda.
                </p>
              )}
              {contas.map((conta) => (
                <div
                  key={conta.id}
                  className={`rounded-md border p-2.5 text-sm ${
                    conta.ativa ? "bg-background" : "bg-muted/40 opacity-70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">
                          {conta.descricao}
                        </span>
                        {conta.recorrente && (
                          <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        {!conta.ativa && (
                          <Badge variant="outline">inativa</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatBRL(conta.valor)} · vence dia {conta.diaVencimento}
                        {conta.categoria ? ` · ${conta.categoria.nome}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => editar(conta)}
                        aria-label="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {conta.ativa && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          disabled={desativar.isPending}
                          onClick={() => desativar.mutate(conta.id)}
                          aria-label="Desativar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              As contas fixas geram ocorrências automáticas em Contas a Pagar e
              aparecem na Agenda no dia do vencimento.
            </p>
          </div>
        </div>

        {/* Backfill: gera as parcelas retroativas (meses passados já pagos). */}
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4 text-muted-foreground" />
            Gerar histórico de parcelas
          </div>
          <p className="text-[11px] text-muted-foreground">
            Cria as parcelas de cada conta fixa ativa a partir da data abaixo.
            Meses anteriores ao atual já entram como <strong>pagos</strong> (com
            saída de caixa na data do vencimento); o mês atual fica em aberto.
            É idempotente — pode rodar mais de uma vez sem duplicar.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="cf-backfill" className="text-xs">
                A partir de
              </Label>
              <Input
                id="cf-backfill"
                type="date"
                value={backfillDe}
                onChange={(e) => setBackfillDe(e.target.value)}
                className="h-9 w-[170px]"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={gerarHistorico.isPending || !backfillDe}
              onClick={() => gerarHistorico.mutate()}
            >
              <History className="mr-2 h-4 w-4" />
              {gerarHistorico.isPending ? "Gerando…" : "Gerar histórico"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
