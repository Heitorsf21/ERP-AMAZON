"use client";

import * as React from "react";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type BolsaInfo = {
  bolsa: string;
  label: string;
  cor: string;
};

type Janela = {
  dias: number;
  receitaProjetada: number;
  saldoProjetado: number;
  distribuicao: Record<string, number>;
};

type Props = {
  bolsas: BolsaInfo[];
  janelas: Janela[];
  mediaDiariaCentavos: number;
  baseHistoricoDias: number;
};

export function CardProjecao({
  bolsas,
  janelas,
  mediaDiariaCentavos,
  baseHistoricoDias,
}: Props) {
  const semHistorico = mediaDiariaCentavos === 0;
  const negativo = mediaDiariaCentavos < 0;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Projeção 30 / 60 / 90 dias</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Baseado na média diária líquida (entradas − saídas) dos últimos{" "}
          {baseHistoricoDias} dias:{" "}
          <span
            className={cn(
              "font-semibold tabular-nums",
              negativo ? "text-destructive" : "text-foreground",
            )}
          >
            {formatBRL(mediaDiariaCentavos)}
          </span>
          /dia
        </p>
      </div>

      {semHistorico ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          Sem movimentações suficientes nos últimos {baseHistoricoDias} dias
          para projetar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Bolsa</th>
                {janelas.map((j) => (
                  <th
                    key={j.dias}
                    className="px-2 py-2 text-right font-medium tabular-nums"
                  >
                    {j.dias}d
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-muted/20">
                <td className="py-2 pr-2 text-[11px] font-semibold">
                  Saldo projetado
                </td>
                {janelas.map((j) => (
                  <td
                    key={j.dias}
                    className={cn(
                      "px-2 py-2 text-right text-[11px] font-semibold tabular-nums",
                      j.saldoProjetado < 0 && "text-destructive",
                    )}
                  >
                    {formatBRL(j.saldoProjetado)}
                  </td>
                ))}
              </tr>
              {bolsas.map((b) => (
                <tr key={b.bolsa} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: b.cor }}
                      />
                      {b.label}
                    </span>
                  </td>
                  {janelas.map((j) => (
                    <td
                      key={j.dias}
                      className="px-2 py-1.5 text-right tabular-nums"
                    >
                      {formatBRL(j.distribuicao[b.bolsa] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
