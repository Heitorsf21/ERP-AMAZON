"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type BolsaInfo = {
  bolsa: string;
  label: string;
  descricao: string;
  cor: string;
};

type Props = {
  bolsas: BolsaInfo[];
  percentuaisIniciais: Record<string, number>;
  defaults: Record<string, number>;
};

/** Soma os percentuais de todas as bolsas exceto a indicada. */
function BOLSAS_KEYS_FROM(
  valores: Record<string, number>,
  exceto: string,
): number {
  let total = 0;
  for (const k of Object.keys(valores)) {
    if (k === exceto) continue;
    total += valores[k] || 0;
  }
  return total;
}

export function FormPercentuais({
  bolsas,
  percentuaisIniciais,
  defaults,
}: Props) {
  const qc = useQueryClient();
  const [valores, setValores] = React.useState<Record<string, number>>(
    () => ({ ...percentuaisIniciais }),
  );
  const [dirty, setDirty] = React.useState(false);

  // Sincroniza quando os iniciais mudarem (ex.: refetch após salvar).
  React.useEffect(() => {
    if (!dirty) setValores({ ...percentuaisIniciais });
  }, [percentuaisIniciais, dirty]);

  const soma = Object.values(valores).reduce((acc, v) => acc + (v || 0), 0);
  const somaArred = Math.round(soma * 10) / 10;
  const valido = Math.abs(soma - 100) < 0.01;
  const excedeu = soma > 100 + 0.01;
  const incompleto = soma < 100 - 0.01;
  const restante = Math.max(0, 100 - soma);

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, number>) => {
      return fetchJSON<{ percentuais: Record<string, number> }>(
        "/api/destinacao/percentuais",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: () => {
      toast.success("Percentuais salvos");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["destinacao-resumo"] });
      qc.invalidateQueries({ queryKey: ["destinacao-distribuicao"] });
      qc.invalidateQueries({ queryKey: ["destinacao-percentuais"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  /**
   * Clamp suave: bloqueia digitação que ultrapasse 100% no total.
   * O valor é limitado ao máximo permitido (100 - soma das outras bolsas).
   * Valores fora de [0, 100] também são rejeitados.
   */
  function alterar(bolsa: string, raw: string) {
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return;
    setValores((prev) => {
      const somaOutras = BOLSAS_KEYS_FROM(prev, bolsa);
      const max = Math.max(0, 100 - somaOutras);
      const clamped = Math.min(n, max);
      if (clamped === prev[bolsa]) return prev;
      return { ...prev, [bolsa]: clamped };
    });
    setDirty(true);
  }

  function aplicarDefaults() {
    setValores({ ...defaults });
    setDirty(true);
  }

  function salvar() {
    if (!valido) {
      toast.error(`Soma deve ser 100% (atual: ${soma.toFixed(1)}%)`);
      return;
    }
    mutation.mutate(valores);
  }

  const saveDisabledMsg = excedeu
    ? `Total não pode exceder 100% (atual: ${somaArred}%)`
    : incompleto
      ? `Faltam ${restante.toFixed(1)}% para fechar 100%`
      : undefined;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Configurar percentuais</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Defina como dividir o saldo livre projetado. A soma precisa fechar 100%.
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            valido
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : excedeu
                ? "bg-destructive/10 text-destructive"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
          title={
            valido
              ? "Soma exatamente 100%"
              : excedeu
                ? "Total acima de 100% — impossível"
                : `Faltam ${restante.toFixed(1)}% para fechar`
          }
        >
          {somaArred}% / 100%
        </span>
      </div>

      <div className="space-y-3">
        {bolsas.map((b) => {
          const v = valores[b.bolsa] ?? 0;
          const somaOutras = BOLSAS_KEYS_FROM(valores, b.bolsa);
          const maxBolsa = Math.max(0, Math.min(100, 100 - somaOutras));
          return (
            <div key={b.bolsa} className="grid grid-cols-12 items-center gap-3">
              <div className="col-span-5 flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: b.cor }}
                />
                <div className="min-w-0">
                  <Label
                    htmlFor={`pct-${b.bolsa}`}
                    className="block truncate text-xs font-medium"
                  >
                    {b.label}
                  </Label>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {b.descricao}
                  </p>
                </div>
              </div>
              <div className="col-span-5">
                <input
                  type="range"
                  min={0}
                  max={maxBolsa}
                  step={1}
                  value={v}
                  onChange={(e) => alterar(b.bolsa, e.target.value)}
                  className="w-full accent-primary"
                  aria-label={`Slider ${b.label}`}
                  title={`Máximo permitido: ${maxBolsa}%`}
                />
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <Input
                  id={`pct-${b.bolsa}`}
                  type="number"
                  min={0}
                  max={maxBolsa}
                  step={1}
                  value={v}
                  onChange={(e) => alterar(b.bolsa, e.target.value)}
                  className="h-8 w-full px-2 text-right text-xs tabular-nums"
                  title={`Máximo permitido agora: ${maxBolsa}%`}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feedback agregado abaixo dos inputs */}
      <div
        className={cn(
          "mt-4 rounded-md border px-3 py-2 text-[11px]",
          valido
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : excedeu
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
        )}
        role="status"
        aria-live="polite"
      >
        {valido ? (
          <span>Total: <strong className="tabular-nums">100%</strong> — pronto para salvar.</span>
        ) : excedeu ? (
          <span>
            Total: <strong className="tabular-nums">{somaArred}%</strong> — excede 100%. Reduza alguma bolsa antes de salvar.
          </span>
        ) : (
          <span>
            Total: <strong className="tabular-nums">{somaArred}%</strong> — faltam{" "}
            <strong className="tabular-nums">{restante.toFixed(1)}%</strong> para fechar 100%.
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={aplicarDefaults}
          disabled={mutation.isPending}
        >
          Restaurar padrão
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={salvar}
          disabled={!valido || !dirty || mutation.isPending}
          title={saveDisabledMsg}
        >
          {mutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
