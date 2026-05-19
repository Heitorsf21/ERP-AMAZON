import { Calendar, Clock, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  statusToBadgeVariant,
  statusToLabel,
  statusToVisual,
} from "@/lib/vendas-status";
import { MarketplaceTag } from "./marketplace-tag";
import { StatusDot } from "./status-dot";

/**
 * Cabeçalho do card de pedido (sempre visível, mesmo colapsado).
 *
 * Layout (do print do Gestor Seller):
 *   [dot] [📅 data] [🕐 hora] [🚚 logística]   [badge]      [marketplace]
 *                                              ───── direita ─────────
 */
export function OrderCardHeader({
  statusPedido,
  statusFinanceiro,
  dataVenda,
  logisticaLabel,
  marketplaceLabel,
}: {
  statusPedido: string | null;
  statusFinanceiro: string | null;
  dataVenda: string;
  logisticaLabel: string;
  marketplaceLabel: string | null;
}) {
  const visual = statusToVisual(statusPedido, statusFinanceiro);
  const variant = statusToBadgeVariant(visual);
  const label = statusToLabel(visual);

  const data = new Date(dataVenda);
  const dataStr = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const horaStr = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 text-sm",
        "sm:px-5",
      )}
    >
      <StatusDot status={visual} />
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-medium text-foreground">{dataStr}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="tabular-nums">{horaStr}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Truck className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{logisticaLabel}</span>
      </span>
      <Badge variant={variant} className="ml-auto">
        {label}
      </Badge>
      <MarketplaceTag label={marketplaceLabel} />
    </div>
  );
}
