"use client";

import * as React from "react";
import { Check, ChevronDown, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FiltroPeriodo,
  type FiltroPeriodoValue,
} from "@/components/ui/filtro-periodo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FiltrosVendas = {
  periodo: FiltroPeriodoValue;
  sku: string;
  logistica: "" | "AFN" | "MFN";
  statuses: string[];
};

const STATUS_OPCOES: Array<{ value: string; label: string }> = [
  { value: "Shipped", label: "Enviado" },
  { value: "Pending", label: "Pendente" },
  { value: "Canceled", label: "Cancelado" },
  { value: "REEMBOLSADO", label: "Reembolsado" },
];

/**
 * Toolbar de filtros da página `/vendas` — estilo "chips" do mockup V5.
 *
 * Composta por:
 *   - FiltroPeriodo (presets compartilhados com Dashboard E-commerce)
 *   - Chip "Logística" (FBA/FBM/Todas) — mapeia para fulfillmentChannel
 *   - Chip "Status" multi-select (popover com checkboxes)
 *   - Chip "SKU" (input texto)
 *   - Botão "Limpar" aparece quando há ≥ 1 filtro além do período padrão
 */
export function FiltrosToolbar({
  filtros,
  onChange,
  defaultPeriodoLabel,
}: {
  filtros: FiltrosVendas;
  onChange: (next: FiltrosVendas) => void;
  defaultPeriodoLabel?: string;
}) {
  const temFiltroExtra =
    filtros.sku !== "" ||
    filtros.logistica !== "" ||
    filtros.statuses.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FiltroPeriodo
        value={filtros.periodo}
        onChange={(p) => onChange({ ...filtros, periodo: p })}
      />

      <LogisticaChip
        value={filtros.logistica}
        onChange={(l) => onChange({ ...filtros, logistica: l })}
      />

      <StatusChip
        value={filtros.statuses}
        onChange={(s) => onChange({ ...filtros, statuses: s })}
      />

      <SkuChip
        value={filtros.sku}
        onChange={(s) => onChange({ ...filtros, sku: s })}
      />

      {temFiltroExtra && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs text-muted-foreground"
          onClick={() =>
            onChange({
              ...filtros,
              sku: "",
              logistica: "",
              statuses: [],
            })
          }
        >
          <X className="mr-1 h-3 w-3" />
          Limpar
        </Button>
      )}

      {defaultPeriodoLabel && (
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Filter className="h-3 w-3" />
          {defaultPeriodoLabel}
        </span>
      )}
    </div>
  );
}

function LogisticaChip({
  value,
  onChange,
}: {
  value: FiltrosVendas["logistica"];
  onChange: (v: FiltrosVendas["logistica"]) => void;
}) {
  const label =
    value === "AFN" ? "FBA" : value === "MFN" ? "FBM" : "Logística";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={value ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {[
          { v: "" as const, l: "Todas" },
          { v: "AFN" as const, l: "FBA - Amazon" },
          { v: "MFN" as const, l: "FBM - Vendedor" },
        ].map((opt) => {
          const ativo = value === opt.v;
          return (
            <button
              key={opt.v}
              type="button"
              onClick={() => onChange(opt.v)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm",
                ativo
                  ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {opt.l}
              {ativo && <Check className="h-3.5 w-3.5" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function StatusChip({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const count = value.length;
  const label = count === 0 ? "Status" : `Status · ${count}`;

  function toggle(s: string) {
    onChange(value.includes(s) ? value.filter((v) => v !== s) : [...value, s]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        {STATUS_OPCOES.map((opt) => {
          const ativo = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm",
                ativo
                  ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {opt.label}
              {ativo && <Check className="h-3.5 w-3.5" />}
            </button>
          );
        })}
        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            Limpar status
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SkuChip({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [rascunho, setRascunho] = React.useState(value);

  React.useEffect(() => {
    if (aberto) setRascunho(value);
  }, [aberto, value]);

  const label = value ? `SKU: ${value}` : "SKU";

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant={value ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5"
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <Label htmlFor="filtro-sku" className="text-xs">
          Buscar SKU
        </Label>
        <Input
          id="filtro-sku"
          placeholder="ex: MFS-0033"
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onChange(rascunho.trim());
              setAberto(false);
            }
          }}
          className="mt-1.5"
          autoFocus
        />
        <div className="mt-2 flex justify-end gap-1">
          {value && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange("");
                setRascunho("");
                setAberto(false);
              }}
            >
              Limpar
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              onChange(rascunho.trim());
              setAberto(false);
            }}
          >
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
