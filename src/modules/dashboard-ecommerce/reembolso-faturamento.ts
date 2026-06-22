import {
  STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO,
  STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO,
  normalizarStatus,
} from "@/modules/vendas/filtros";

// Separador da chave (amazonOrderId + sku). Nenhum SKU/orderId contem "||".
const SEPARADOR_CHAVE = "||";

export function chaveVendaReembolso(venda: {
  amazonOrderId: string;
  sku: string;
}): string {
  return `${venda.amazonOrderId}${SEPARADOR_CHAVE}${venda.sku}`;
}

/**
 * Uma venda só é considerada TOTALMENTE reembolsada quando está marcada como
 * REEMBOLSADO (em statusPedido OU statusFinanceiro). É exatamente o que o
 * finance-materializer faz para reembolso TOTAL (refundCobreVenda); reembolso
 * PARCIAL cria o AmazonReembolso mas NÃO marca a venda.
 */
export function isVendaTotalmenteReembolsada(venda: {
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
}): boolean {
  return (
    STATUS_PEDIDO_REEMBOLSADO_NORMALIZADO.has(
      normalizarStatus(venda.statusPedido),
    ) ||
    STATUS_FINANCEIRO_NAO_CONTABILIZAVEL_NORMALIZADO.has(
      normalizarStatus(venda.statusFinanceiro),
    )
  );
}

/**
 * Separa as vendas-base de um período entre as que entram no faturamento
 * (`faturaveis`) e as que são removidas por reembolso (`reembolsadas`).
 *
 * Regra (preserva a lógica de separação do Gestor Seller, sem o bug do parcial):
 * uma venda só é removida do faturamento quando:
 *   1. tem um AmazonReembolso na janela consultada (chave em `reembolsoKeys`), E
 *   2. está marcada como REEMBOLSADO (reembolso TOTAL).
 *
 * Reembolso PARCIAL (ex.: só frete) cria AmazonReembolso na janela mas NÃO marca
 * a venda — então ela PERMANECE no faturamento. Antes, qualquer reembolso (mesmo
 * parcial) zerava a venda inteira, abatendo a mais.
 */
export function separarVendasReembolsadas<
  T extends {
    amazonOrderId: string;
    sku: string;
    statusPedido?: string | null;
    statusFinanceiro?: string | null;
  },
>(base: T[], reembolsoKeys: Set<string>): { faturaveis: T[]; reembolsadas: T[] } {
  const faturaveis: T[] = [];
  const reembolsadas: T[] = [];

  for (const venda of base) {
    const temReembolsoNaJanela = reembolsoKeys.has(chaveVendaReembolso(venda));
    if (temReembolsoNaJanela && isVendaTotalmenteReembolsada(venda)) {
      reembolsadas.push(venda);
    } else {
      faturaveis.push(venda);
    }
  }

  return { faturaveis, reembolsadas };
}
