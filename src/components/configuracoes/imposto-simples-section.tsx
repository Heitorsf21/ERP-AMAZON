"use client";

import * as React from "react";
import { Landmark, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type ConfigImpostoSimples = {
  aliquotaBps: number;
  ativo: boolean;
};

function bpsToPercentString(bps: number): string {
  const valor = bps / 100;
  if (Number.isInteger(valor)) return String(valor);
  return valor.toFixed(2);
}

function percentToBps(input: string): number | null {
  const normalizado = input.replace(",", ".").trim();
  if (normalizado === "") return null;
  const n = Number(normalizado);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function ImpostoSimplesSection() {
  const [carregando, setCarregando] = React.useState(true);
  const [salvando, setSalvando] = React.useState(false);
  const [percent, setPercent] = React.useState("6");
  const [ativo, setAtivo] = React.useState(true);

  React.useEffect(() => {
    let cancelado = false;
    async function carregar() {
      try {
        const res = await fetch("/api/configuracoes/imposto-simples", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Falha ao carregar configuracao");
        const data = (await res.json()) as ConfigImpostoSimples;
        if (cancelado) return;
        setPercent(bpsToPercentString(data.aliquotaBps));
        setAtivo(data.ativo);
      } catch (err) {
        if (!cancelado) {
          toast.error(
            err instanceof Error ? err.message : "Erro ao carregar configuracao",
          );
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => {
      cancelado = true;
    };
  }, []);

  async function salvar() {
    const aliquotaBps = percentToBps(percent);
    if (aliquotaBps == null) {
      toast.error("Aliquota invalida. Use um numero >= 0 (ex: 6 ou 6,00)");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/configuracoes/imposto-simples", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliquotaBps, ativo }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(data.erro ?? "Falha ao salvar configuracao");
      }
      const data = (await res.json()) as ConfigImpostoSimples;
      setPercent(bpsToPercentString(data.aliquotaBps));
      setAtivo(data.ativo);
      toast.success(
        "Configuracao salva. Vendas futuras gravam imposto com nova aliquota; " +
          "rode o backfill para atualizar o historico.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Imposto Simples Nacional</CardTitle>
            <CardDescription>
              Aliquota sobre o valor bruto de cada venda Amazon. Default 6%
              (Anexo I do Simples). Reembolsos zeram automaticamente.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {carregando ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="imposto-aliquota"
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Aliquota (%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="imposto-aliquota"
                    type="text"
                    inputMode="decimal"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    className="h-9 w-24 rounded-md border bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </p>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ativo}
                    onChange={(e) => setAtivo(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  {ativo ? "Ativo" : "Desativado (margens sem imposto)"}
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={salvar} disabled={salvando} size="sm">
                {salvando ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Salvar
              </Button>
              <p className="text-xs text-muted-foreground">
                Apos salvar, rode <code className="font-mono">npx tsx scripts/backfill-imposto-simples.ts --apply</code>{" "}
                para recalcular vendas existentes.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
