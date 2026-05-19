"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrderCardBreakdown } from "./order-card-breakdown";
import { OrderCardDetails } from "./order-card-details";
import { OrderCardHeader } from "./order-card-header";
import { OrderItemsTable } from "./order-items-table";
import type { VendaListagem } from "./types";

const FULFILLMENT_LABELS: Record<string, string> = {
  AFN: "FBA - Logística da Amazon",
  MFN: "FBM - Logística do Vendedor",
  FBA: "FBA - Logística da Amazon",
  FBM: "FBM - Logística do Vendedor",
};

function logisticaLabel(fulfillment: string | null): string {
  if (!fulfillment) return "FBA - Logística da Amazon";
  const key = fulfillment.toUpperCase();
  return FULFILLMENT_LABELS[key] ?? fulfillment;
}

/**
 * Card de pedido com tabela horizontal de item sempre visível e painel
 * expandido (detalhes + breakdown financeiro) controlado via toggle.
 *
 * Cada `<OrderCard>` representa **uma linha de venda** (uma VendaAmazon,
 * chave amazonOrderId+sku). Pedidos com múltiplos SKUs aparecem como
 * múltiplos cards — coerente com o print do Gestor Seller e com o modelo
 * de dados atual.
 */
export function OrderCard({
  venda,
  defaultExpanded = false,
}: {
  venda: VendaListagem;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const logistica = logisticaLabel(venda.fulfillmentChannel);
  const breakdown = venda.breakdown ?? null;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow",
        expanded && "shadow-md",
      )}
    >
      <OrderCardHeader
        statusPedido={venda.statusPedido}
        statusFinanceiro={venda.statusFinanceiro}
        dataVenda={venda.dataVenda}
        logisticaLabel={logistica}
        marketplaceLabel={venda.marketplace ?? venda.fulfillmentChannel ?? "—"}
      />

      <OrderItemsTable venda={venda} breakdown={breakdown} />

      {expanded && breakdown && (
        <div className="grid gap-4 border-t bg-background p-4 sm:p-5 md:grid-cols-[1fr_340px]">
          <OrderCardDetails venda={venda} logisticaLabel={logistica} />
          <OrderCardBreakdown breakdown={breakdown} />
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center justify-center gap-2 border-t bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
        )}
      >
        {expanded ? "Ocultar detalhes" : "Ver detalhes do pedido"}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
    </article>
  );
}
