"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ShoppingBag, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { OrderCard } from "./order-card";
import type { VendaListagem } from "./types";

/**
 * Lista paginada de pedidos em formato de cards expansíveis.
 *
 * O primeiro pedido vem expandido por padrão para que o usuário veja o
 * layout completo logo no carregamento (mesmo comportamento do mockup V5).
 */
export function OrderCardList({
  isLoading,
  vendas,
  pagina,
  totalPaginas,
  total,
  setPagina,
  onImportar,
  emptyHint,
}: {
  isLoading: boolean;
  vendas: VendaListagem[];
  pagina: number;
  totalPaginas: number;
  total: number;
  setPagina: React.Dispatch<React.SetStateAction<number>>;
  onImportar?: () => void;
  emptyHint?: string;
}) {
  if (isLoading) {
    return <DataTableSkeleton rows={4} columns={4} />;
  }

  if (vendas.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
        <ShoppingBag className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium text-muted-foreground">
          {emptyHint ?? "Nenhuma venda encontrada"}
        </p>
        {onImportar && (
          <Button size="sm" onClick={onImportar}>
            <Upload className="mr-2 h-4 w-4" />
            Importar arquivo
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {vendas.map((venda, idx) => (
        <OrderCard key={venda.id} venda={venda} defaultExpanded={idx === 0} />
      ))}

      <Paginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        total={total}
        setPagina={setPagina}
      />
    </div>
  );
}

function Paginacao({
  pagina,
  totalPaginas,
  total,
  setPagina,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  setPagina: React.Dispatch<React.SetStateAction<number>>;
}) {
  if (totalPaginas <= 1) return null;
  return (
    <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Página <strong className="text-foreground">{pagina}</strong> de{" "}
        <strong className="text-foreground">{totalPaginas}</strong> —{" "}
        {total} pedidos
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={pagina <= 1}
          onClick={() => setPagina((p) => p - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pagina >= totalPaginas}
          onClick={() => setPagina((p) => p + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
