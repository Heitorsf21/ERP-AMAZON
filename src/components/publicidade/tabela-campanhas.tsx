"use client";

import * as React from "react";
import { BarChart3, EyeOff, Search } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  tipoCampanha: string | null;
  estadoCampanha: string | null;
};

const FILTROS_ACOS = [
  { v: "todos", label: "Todos ACoS" },
  { v: "excelente", label: "Excelente" },
  { v: "bom", label: "Bom" },
  { v: "atencao", label: "Atenção" },
  { v: "alto", label: "Alto" },
  { v: "critico", label: "Crítico" },
] as const;

const FILTROS_TIPO = [
  { v: "todos", label: "Todos tipos" },
  { v: "auto", label: "Automática" },
  { v: "manual", label: "Manual" },
] as const;

function casaFiltroAcos(acos: number | null, filtro: string): boolean {
  if (filtro === "todos") return true;
  if (acos == null) return false;
  switch (filtro) {
    case "excelente": return acos < 15;
    case "bom":       return acos >= 15 && acos < 25;
    case "atencao":   return acos >= 25 && acos < 35;
    case "alto":      return acos >= 35 && acos < 50;
    case "critico":   return acos >= 50;
    default:          return true;
  }
}

function casaFiltroTipo(tipo: string | null, filtro: string): boolean {
  if (filtro === "todos") return true;
  if (tipo == null) return false;
  const t = tipo.toUpperCase();
  if (filtro === "auto")   return t === "AUTO";
  if (filtro === "manual") return t === "MANUAL";
  return true;
}

function BadgeTipo({ tipo }: { tipo: string | null }) {
  if (!tipo) return null;
  const t = tipo.toUpperCase();
  if (t === "AUTO") {
    return (
      <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        Auto
      </span>
    );
  }
  if (t === "MANUAL") {
    return (
      <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Manual
      </span>
    );
  }
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {tipo}
    </span>
  );
}

function BadgeEstado({ estado }: { estado: string | null }) {
  if (!estado) return null;
  const e = estado.toUpperCase();
  if (e === "PAUSED" || e === "PAUSADA") {
    return (
      <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Pausada
      </span>
    );
  }
  return null;
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
  const [filtroTipo, setFiltroTipo] = React.useState<string>("todos");
  const [ocultarSemGasto, setOcultarSemGasto] = React.useState(true);

  const { filtradas, ocultadas } = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    let semGasto = 0;
    const resultado = campanhas.filter((c) => {
      if (ocultarSemGasto && c.gastoCentavos === 0) {
        semGasto++;
        return false;
      }
      if (!casaFiltroAcos(c.acosPercentual, filtroAcos)) return false;
      if (!casaFiltroTipo(c.tipoCampanha, filtroTipo)) return false;
      if (!termo) return true;
      const alvo = `${c.nomeCampanha} ${c.sku ?? ""} ${c.asin ?? ""}`.toLowerCase();
      return alvo.includes(termo);
    });
    return { filtradas: resultado, ocultadas: semGasto };
  }, [campanhas, busca, filtroAcos, filtroTipo, ocultarSemGasto]);

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
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar campanha, SKU ou ASIN…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="w-36"
          >
            {FILTROS_TIPO.map((f) => (
              <option key={f.v} value={f.v}>
                {f.label}
              </option>
            ))}
          </Select>
          <Select
            value={filtroAcos}
            onChange={(e) => setFiltroAcos(e.target.value)}
            className="w-36"
          >
            {FILTROS_ACOS.map((f) => (
              <option key={f.v} value={f.v}>
                {f.label}
              </option>
            ))}
          </Select>
          <Button
            variant={ocultarSemGasto ? "secondary" : "outline"}
            size="sm"
            onClick={() => setOcultarSemGasto((v) => !v)}
            className="gap-1.5"
          >
            <EyeOff className="h-3.5 w-3.5" />
            Sem gasto
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {filtradas.length} de {campanhas.length}
            {ocultarSemGasto && ocultadas > 0 && (
              <> · <span className="text-amber-600 dark:text-amber-400">{ocultadas} sem gasto ocultas</span></>
            )}
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
              {filtradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma campanha encontrada com os filtros aplicados.
                  </TableCell>
                </TableRow>
              ) : (
                filtradas.map((c) => {
                  const classif = classificarAcos(c.acosPercentual);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block max-w-[240px] truncate text-sm font-medium">
                                {c.nomeCampanha}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              {c.nomeCampanha}
                            </TooltipContent>
                          </Tooltip>
                          <div className="flex flex-wrap items-center gap-1">
                            <BadgeTipo tipo={c.tipoCampanha} />
                            <BadgeEstado estado={c.estadoCampanha} />
                            {(c.sku || c.asin) && (
                              <span className="text-xs text-muted-foreground">
                                {c.sku ?? "—"}
                                {c.asin ? ` · ${c.asin}` : ""}
                              </span>
                            )}
                          </div>
                        </div>
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
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </TooltipProvider>
  );
}
