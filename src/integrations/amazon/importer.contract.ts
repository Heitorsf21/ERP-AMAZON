// Contrato da integracao com relatorios/API da Amazon.
//
// O importador CSV inicial vive em unified-transactions.ts. A ideia deste
// contrato e manter o formato interno estavel enquanto a fonte evolui de
// relatorio manual para automacao de navegador e, depois, SP-API.

export interface VendaAmazon {
  /** ID Amazon do pedido. */
  amazonOrderId: string;
  /** ID do item do pedido quando a fonte disponibilizar. */
  orderItemId?: string;
  /** Identificador mestre do produto (ver regra SKU do ERP). */
  sku: string;
  asin?: string;
  titulo?: string;
  quantidade: number;
  /** Preco unitario do item em centavos, sem depender de Float. */
  precoUnitarioCentavos: number;
  /** Total bruto do item. Mantido para compatibilidade com analisadores antigos. */
  valorBrutoCentavos?: number;
  /** Taxas de marketplace/comissao em centavos (valor positivo). */
  taxasCentavos: number;
  /** Frete/FBA fulfillment em centavos (valor positivo). */
  fretesCentavos: number;
  /** Valor liquido oficial/estimado do marketplace em centavos. */
  liquidoMarketplaceCentavos?: number;
  /** Snapshot do custo no momento da importacao, quando conhecido. */
  custoUnitarioCentavos?: number | null;
  liquidacaoId?: string;
  fulfillmentChannel?: string;
  statusPedido?: string;
  statusFinanceiro?: string;
  dataVenda: Date;
  marketplace: string;
  referenciaExterna: string;
}

export interface AmazonReembolso {
  amazonOrderId: string;
  orderItemId?: string;
  sku: string;
  asin?: string;
  titulo?: string;
  quantidade: number;
  valorReembolsadoCentavos: number;
  taxasReembolsadasCentavos?: number;
  dataReembolso: Date;
  liquidacaoId?: string;
  marketplace?: string;
  referenciaExterna: string;
  statusFinanceiro?: string;
}

export interface AmazonImporter {
  /** Le o relatorio da fonte externa e devolve vendas normalizadas. */
  importarVendas(input: unknown): Promise<VendaAmazon[]>;
}
