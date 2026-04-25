"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export type FiltrosNotasFiscais = {
  busca: string;
  tipo: "" | "BOLETO" | "NOTA_FISCAL" | "OUTRO";
  status: "" | "PENDENTE" | "VINCULADO_CONTA";
  de: string;
  ate: string;
};

export const FILTROS_INICIAIS: FiltrosNotasFiscais = {
  busca: "",
  tipo: "",
  status: "",
  de: "",
  ate: "",
};

export function FiltrosNotasFiscaisToolbar({
  filtros,
  onChange,
}: {
  filtros: FiltrosNotasFiscais;
  onChange: (next: FiltrosNotasFiscais) => void;
}) {
  function set<K extends keyof FiltrosNotasFiscais>(
    key: K,
    valor: FiltrosNotasFiscais[K],
  ) {
    onChange({ ...filtros, [key]: valor });
  }

  const limpar = () => onChange(FILTROS_INICIAIS);

  const algumFiltroAtivo =
    filtros.busca || filtros.tipo || filtros.status || filtros.de || filtros.ate;

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="filtro-busca">Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="filtro-busca"
              value={filtros.busca}
              placeholder="fornecedor, nº doc, descrição..."
              className="pl-8"
              onChange={(e) => set("busca", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-tipo">Tipo</Label>
          <Select
            id="filtro-tipo"
            value={filtros.tipo}
            onChange={(e) =>
              set("tipo", e.target.value as FiltrosNotasFiscais["tipo"])
            }
          >
            <option value="">Todos</option>
            <option value="BOLETO">Boleto</option>
            <option value="NOTA_FISCAL">Nota Fiscal</option>
            <option value="OUTRO">Outro</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-status">Status</Label>
          <Select
            id="filtro-status"
            value={filtros.status}
            onChange={(e) =>
              set("status", e.target.value as FiltrosNotasFiscais["status"])
            }
          >
            <option value="">Todos</option>
            <option value="PENDENTE">Pendentes</option>
            <option value="VINCULADO_CONTA">Vinculados</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-de">Vencimento de</Label>
          <Input
            id="filtro-de"
            type="date"
            value={filtros.de}
            onChange={(e) => set("de", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="filtro-ate">Vencimento até</Label>
          <Input
            id="filtro-ate"
            type="date"
            value={filtros.ate}
            onChange={(e) => set("ate", e.target.value)}
          />
        </div>
      </div>

      {algumFiltroAtivo && (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={limpar}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        </div>
      )}
    </div>
  );
}
