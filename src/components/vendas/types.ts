/**
 * Tipos compartilhados pela página `/vendas` e seus componentes.
 *
 * `BreakdownVendaPayload` espelha a forma de
 * [`BreakdownVenda`](../../modules/vendas/breakdown.ts) que volta no
 * payload da API (todas as datas como `number | string` já serializadas).
 */
import type { BreakdownOrigem } from "@/modules/vendas/breakdown";

export type BreakdownVendaPayload = {
  totalItensCentavos: number;
  freteRecebidoCentavos: number;
  fretePagoCentavos: number;
  comissaoCentavos: number;
  taxaFbaCentavos: number;
  taxaParcelamentoCentavos: number;
  closingFeeCentavos: number;
  promoRebatesCentavos: number;
  impostoCentavos: number;
  custoProdutoCentavos: number;
  custoExtraCentavos: number;
  lucroCentavos: number;
  margemBps: number;
  origem: BreakdownOrigem;
  categoriaTaxaSlug: string | null;
  categoriaTaxaLabel: string | null;
};

export type VendaListagem = {
  id: string;
  amazonOrderId: string;
  orderItemId: string | null;
  marketplace: string | null;
  statusPedido: string;
  statusFinanceiro: string;
  dataVenda: string;
  sku: string;
  asin: string | null;
  titulo: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  valorBrutoCentavos: number | null;
  taxasCentavos: number;
  fretesCentavos: number;
  liquidoMarketplaceCentavos: number | null;
  custoUnitarioCentavos: number | null;
  fulfillmentChannel: string | null;
  liquidacaoId: string | null;
  ultimaSyncEm: string | null;
  totalCentavos: number;
  // Enriquecimentos vindos da nova /api/vendas
  breakdown?: BreakdownVendaPayload;
  produtoImagemUrl?: string | null;
  produtoAsin?: string | null;
  taxasEstimadas?: boolean;
  categoriaTaxaEstimada?: { slug: string | null; label: string; regra: string };
};
