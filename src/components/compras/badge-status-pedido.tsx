import { Badge } from "@/components/ui/badge";
import { StatusPedidoCompra } from "@/modules/shared/domain";

const config: Record<string, { label: string; variant: "secondary" | "outline" | "success" | "warning" | "destructive" }> = {
  [StatusPedidoCompra.RASCUNHO]: { label: "Rascunho", variant: "secondary" },
  [StatusPedidoCompra.CONFIRMADO]: { label: "Confirmado", variant: "warning" },
  [StatusPedidoCompra.RECEBIDO]: { label: "Recebido", variant: "success" },
  [StatusPedidoCompra.CANCELADO]: { label: "Cancelado", variant: "destructive" },
};

export function BadgeStatusPedido({ status }: { status: string }) {
  const c = config[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
