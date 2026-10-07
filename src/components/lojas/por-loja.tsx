"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarginBadge, MPA_THRESHOLDS } from "@/components/ui/margin-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PorLoja } from "@/modules/lojas/consolidado";
import { useLojas, useTrocarLoja } from "./use-lojas";
import { useVisaoInicio } from "./visao-inicio";

export type { PorLoja };

function percentualBR(valor: number | null): string {
  if (valor == null) return "—";
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

function useCorPorEmpresa() {
  const { lojas } = useLojas();
  return new Map(lojas.map((l) => [l.empresaId, l.cor]));
}

/** Celular, visão "Todas": quanto cada loja trouxe; tocar abre aquela loja. */
export function PorLojaMobile({ porLoja }: { porLoja: PorLoja[] }) {
  const cores = useCorPorEmpresa();
  const { trocar, trocandoPara } = useTrocarLoja();
  const [, definirVisao] = useVisaoInicio();

  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="por-loja-titulo">
      <div className="px-4 pb-2 pt-3">
        <h2 id="por-loja-titulo" className="text-base font-semibold">
          Por loja
        </h2>
        <p className="text-xs text-muted-foreground">quanto cada loja trouxe do faturamento</p>
        <div aria-hidden className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
          {porLoja.map((l) => (
            <span
              key={l.empresaId}
              className={cn("h-full", cores.get(l.empresaId)?.barra)}
              style={{ width: `${l.participacaoPercentual ?? 0}%` }}
            />
          ))}
        </div>
      </div>
      {porLoja.map((l) => (
        <button
          key={l.empresaId}
          type="button"
          disabled={trocandoPara != null}
          onClick={() =>
            l.atual
              ? definirVisao("loja")
              : void trocar(l.empresaId, { destino: "/dashboard-ecommerce", visao: "loja" })
          }
          className="flex w-full items-center gap-3 border-t px-4 py-3 text-left active:bg-muted/60 disabled:opacity-60"
        >
          <span
            aria-hidden
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", cores.get(l.empresaId)?.ponto)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold">
                {l.nome}{" "}
                <span className="font-medium text-muted-foreground">
                  · {percentualBR(l.participacaoPercentual)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums">
                {formatBRL(l.faturamentoCentavos)}
              </span>
            </span>
            <span className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {plural(l.numeroVendas, "venda", "vendas")} · lucro{" "}
                {l.lucroBrutoCentavos == null ? "N/A" : formatBRL(l.lucroBrutoCentavos)}
              </span>
              <MarginBadge value={l.margemPercentual} />
            </span>
          </span>
          {trocandoPara === l.empresaId ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </button>
      ))}
    </section>
  );
}

type Totais = {
  faturamentoCentavos: number;
  lucroBrutoCentavos: number | null;
  margemPercentual: number | null;
  numeroVendas: number;
  mpaPercentual: number | null;
};

/** Computador, visão "Todas": cada loja e o total, no mesmo período. */
export function PorLojaTabela({ porLoja, total }: { porLoja: PorLoja[]; total: Totais }) {
  const cores = useCorPorEmpresa();
  const linhas = [
    ...porLoja.map((l) => ({ ...l, chave: l.empresaId, ponto: cores.get(l.empresaId)?.ponto })),
    { chave: "__total__", nome: "Total", ponto: undefined, ...total },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Por loja</CardTitle>
        <p className="text-xs text-muted-foreground">mesmo período, cada loja e o total</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Loja</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">Lucro</TableHead>
              <TableHead className="text-center">Margem</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
              <TableHead className="text-center">MPA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => {
              const ehTotal = l.chave === "__total__";
              return (
                <TableRow key={l.chave} className={cn(ehTotal && "font-semibold")}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      {l.ponto && (
                        <span aria-hidden className={cn("h-2 w-2 rounded-full", l.ponto)} />
                      )}
                      {l.nome}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(l.faturamentoCentavos)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.lucroBrutoCentavos == null ? (
                      <span className="text-muted-foreground/50">N/A</span>
                    ) : (
                      formatBRL(l.lucroBrutoCentavos)
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <MarginBadge value={l.margemPercentual} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.numeroVendas.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-center">
                    <MarginBadge value={l.mpaPercentual} thresholds={MPA_THRESHOLDS} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
