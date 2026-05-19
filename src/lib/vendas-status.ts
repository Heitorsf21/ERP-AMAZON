/**
 * Mapeamentos de status de VendaAmazon para a UI (cards expansíveis).
 *
 * O schema guarda dois campos quase-livres (`statusPedido` e
 * `statusFinanceiro`) com valores vindos da SP-API em inglês ou já
 * normalizados em português. Esses helpers convertem qualquer combinação
 * para 4 buckets visuais usados pelos componentes:
 *
 *   - pending  → amarelo  → "Pendente"
 *   - done     → verde    → "Concluído"
 *   - cancel   → vermelho → "Cancelado"
 *   - refund   → roxo     → "Reembolsado"
 *
 * Helpers puros (sem I/O). Reusam o `normalizarStatus` e as constantes de
 * [filtros.ts](../modules/vendas/filtros.ts) para evitar divergência.
 */
import {
  STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO,
  STATUS_PEDIDO_CANCELADO,
  STATUS_PEDIDO_PENDENTE,
  STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO,
  normalizarStatus,
} from "@/modules/vendas/filtros";

export type StatusVisual = "pending" | "done" | "cancel" | "refund";

export type BadgeVariant = "success" | "warning" | "destructive" | "secondary";

const CANCELADO_SET = new Set(STATUS_PEDIDO_CANCELADO.map(normalizarStatus));
const PENDENTE_PEDIDO_SET = new Set(STATUS_PEDIDO_PENDENTE.map(normalizarStatus));

export function statusToVisual(
  statusPedido?: string | null,
  statusFinanceiro?: string | null,
): StatusVisual {
  const sp = normalizarStatus(statusPedido ?? "");
  const sf = normalizarStatus(statusFinanceiro ?? "");

  if (
    STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO.has(sp) ||
    STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO.has(sf)
  ) {
    return "refund";
  }
  if (CANCELADO_SET.has(sp)) return "cancel";
  if (PENDENTE_PEDIDO_SET.has(sp) || sf === "PENDENTE") return "pending";
  return "done";
}

export function statusToBadgeVariant(visual: StatusVisual): BadgeVariant {
  switch (visual) {
    case "done":
      return "success";
    case "pending":
      return "warning";
    case "cancel":
      return "destructive";
    case "refund":
      return "secondary";
  }
}

export function statusToLabel(visual: StatusVisual): string {
  switch (visual) {
    case "done":
      return "Concluído";
    case "pending":
      return "Pendente";
    case "cancel":
      return "Cancelado";
    case "refund":
      return "Reembolsado";
  }
}
