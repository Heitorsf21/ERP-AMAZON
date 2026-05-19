"use client";

import * as React from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  formatarDataInputPeriodo,
  PeriodoPreset,
  resolverPeriodo,
} from "@/lib/periodo";

export type FiltroPeriodoValue = {
  preset: PeriodoPreset;
  de?: string; // YYYY-MM-DD quando preset === PERSONALIZADO
  ate?: string;
};

const PRESET_LABELS: Array<{ preset: PeriodoPreset; label: string }> = [
  { preset: PeriodoPreset.HOJE, label: "Hoje" },
  { preset: PeriodoPreset.ONTEM, label: "Ontem" },
  { preset: PeriodoPreset.SETE_DIAS, label: "Últimos 7 dias" },
  { preset: PeriodoPreset.TRINTA_DIAS, label: "Últimos 30 dias" },
  { preset: PeriodoPreset.MES_ATUAL, label: "Mês atual" },
  { preset: PeriodoPreset.MES_PASSADO, label: "Mês passado" },
  { preset: PeriodoPreset.ANO_ATUAL, label: "Ano atual" },
  { preset: PeriodoPreset.PERSONALIZADO, label: "Personalizado" },
];

/**
 * Chip + Popover para selecionar período via presets. Reutiliza o helper
 * canônico em [src/lib/periodo.ts](src/lib/periodo.ts), garantindo que
 * todas as páginas (Dashboard E-commerce, Vendas, etc.) compartilhem a
 * mesma definição de "Hoje", "Mês atual", etc.
 *
 * Quando `preset === "personalizado"`, exibe dois inputs date (de/ate)
 * e só fecha o popover quando `aplicar` é clicado.
 */
export function FiltroPeriodo({
  value,
  onChange,
  className,
}: {
  value: FiltroPeriodoValue;
  onChange: (next: FiltroPeriodoValue) => void;
  className?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<FiltroPeriodoValue>(value);

  React.useEffect(() => {
    if (aberto) setRascunho(value);
  }, [aberto, value]);

  const labelAtual = formatarLabel(value);

  function aplicar(next: FiltroPeriodoValue) {
    onChange(next);
    setAberto(false);
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 gap-1.5 font-medium", className)}
        >
          <Calendar className="h-4 w-4" />
          <span>{labelAtual}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="flex flex-col gap-0.5">
          {PRESET_LABELS.map(({ preset, label }) => {
            const ativo = rascunho.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  if (preset === PeriodoPreset.PERSONALIZADO) {
                    setRascunho({
                      preset,
                      de: rascunho.de ?? hojeIso(),
                      ate: rascunho.ate ?? hojeIso(),
                    });
                  } else {
                    aplicar({ preset });
                  }
                }}
                className={cn(
                  "flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                  ativo
                    ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {label}
                {ativo && (
                  <span className="text-[10px] uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/60">
                    ativo
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {rascunho.preset === PeriodoPreset.PERSONALIZADO && (
          <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="space-y-1">
              <Label htmlFor="periodo-de" className="text-xs">
                De
              </Label>
              <Input
                id="periodo-de"
                type="date"
                value={rascunho.de ?? ""}
                onChange={(e) =>
                  setRascunho((prev) => ({ ...prev, de: e.target.value }))
                }
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="periodo-ate" className="text-xs">
                Até
              </Label>
              <Input
                id="periodo-ate"
                type="date"
                value={rascunho.ate ?? ""}
                onChange={(e) =>
                  setRascunho((prev) => ({ ...prev, ate: e.target.value }))
                }
                className="h-8"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!rascunho.de || !rascunho.ate}
              onClick={() => aplicar(rascunho)}
            >
              Aplicar período
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function formatarLabel(value: FiltroPeriodoValue): string {
  if (value.preset === PeriodoPreset.PERSONALIZADO) {
    if (value.de && value.ate) {
      return `${ddmm(value.de)} → ${ddmm(value.ate)}`;
    }
    return "Personalizado";
  }
  const found = PRESET_LABELS.find((p) => p.preset === value.preset);
  return found?.label ?? "Período";
}

function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function hojeIso(): string {
  const { ate } = resolverPeriodo(PeriodoPreset.HOJE);
  return formatarDataInputPeriodo(ate);
}
