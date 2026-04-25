"use client";

import * as React from "react";
import { BarChart3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { classificarAcos } from "./classificacao-acos";

export type CampanhaTabela = {
  id: string;
  nomeCampanha: string;
  sku: string | null;
  asin: string | null;
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasAtribuidasCentavos: number;
  pedidos: number;
  acosPercentual: number | null;
  roas: number | null;
  ctrPercentual: number | null;
  cpcCentavos: number | null;
  taxaConversaoPercentual: number | null;
};

const FILTROS_ACOS = [
  { v: "todos", label: "Todos" },
  { v: "excelente", label: "Excelente" },
  { v: "bom", label: "Bom" },
  { v: "atencao", label: "Atenção" },
  { v: "alto", label: "Alto" },
  { v: "critico", label: "Crítico" },
] as const;

function casaFiltro(acos: number | null, filtro: string): boolean {
  if (filtro === "todos") return true;
  if (acos == null) return false;
  switch (filtro) {
    case "excelente":
      return acos < 15;
    case "bom":
      return acos >= 15 && acos < 25;
    case "atencao":
      return acos >= 25 && acos < 35;
    case "alto":
      return acos >= 35 && acos < 50;
    case "critico":
      return acos >= 50;
    default:
      return true;
  }
}

export function TabelaCampanhas({
  campanhas,
  onImportar,
}: {
  campanhas: CampanhaTabela[];
  onImportar?: () => void;
}) {
  const [busca, setBusca] = React.useState("");
  const [filtroAcos, setFiltroAcos] = React.useState<string>("todos");

  const filtradas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return campanhas.filter((c) => {
      if (!casaFiltro(c.acosPercentual, filtroAcos)) return false;
      if (!termo) return true;
      const alvo = `${c.nomeCampanha} ${c.sku ?? ""} ${c.asin ?? ""}`.toLowerCase();
      return alvo.includes(termo);
    });
  }, [campanhas, busca, filtroAcos]);

  if (campanhas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
        <BarChart3 className="h-8 w-8 opacity-40" />
        <p className="text-sm">Nenhuma campanha importada no período.</p>
        {onImportar && (
          <Button variant="outline" size="sm" onClick={onImportar}>
            Importar relatório de Ads
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar campanha, SKU ou ASIN…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={filtroAcos}
          onChange={(e) => setFiltroAcos(e.target.value)}
          className="w-40"
        >
          {FILTROS_ACOS.map((f) => (
            <option key={f.v} value={f.v}>
              {f.label}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtradas.length} de {campanhas.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campanha</TableHead>
              <TableHead className="text-right">Investido</TableHead>
              <TableHead className="text-right">Vendas atrib.</TableHead>
              <TableHead className="text-right">ACoS</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">CPC</TableHead>
              <TableHead className="text-right">Conv.</TableHead>
              <TableHead className="text-right">Cliques</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((c) => {
              const classif = classificarAcos(c.acosPercentual);
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="max-w-[260px] truncate text-sm font-medium">
                      {c.nomeCampanha}
                    </div>
                    {(c.sku || c.asin) && (
                      <div className="text-xs text-muted-foreground">
                        {c.sku ?? "—"}
                        {c.asin ? ` · ${c.asin}` : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatBRL(c.gastoCentavos)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.vendasAtribuidasCentavos > 0
                      ? formatBRL(c.vendasAtribuidasCentavos)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-sm tabular-nums">
                        {c.acosPercentual != null
                          ? `${c.acosPercentual.toFixed(1)}%`
                          : "—"}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
                          classif.classe,
                        )}
                      >
                        {classif.label}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.roas != null ? `${c.roas.toFixed(2)}x` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.ctrPercentual != null
                      ? `${c.ctrPercentual.toFixed(2)}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.cpcCentavos != null ? formatBRL(c.cpcCentavos) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.taxaConversaoPercentual != null
                      ? `${c.taxaConversaoPercentual.toFixed(2)}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.cliques.toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {c.pedidos}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
