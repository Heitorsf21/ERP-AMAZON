// Contrato da integracao com relatorios/API da Amazon.
//
// O importador CSV inicial vive em unified-transactions.ts. A ideia deste
// contrato e manter o formato interno estavel enquanto a fonte evolui de
// relatorio manual para automacao de navegador e, depois, SP-API.

export interface VendaAmazon {
  /** Identificador mestre do produto (ver regra SKU do ERP). */
  sku: string;
  asin?: string;
  quantidade: number;
  /** Valor bruto recebido em centavos. */
  valorBrutoCentavos: number;
  /** Taxas, comissoes e outros descontos em centavos (valor positivo). */
  taxasCentavos: number;
  dataVenda: Date;
  marketplace: string;
  referenciaExterna: string;
}

export interface AmazonImporter {
  /** Le o relatorio da fonte externa e devolve vendas normalizadas. */
  importarVendas(input: unknown): Promise<VendaAmazon[]>;
}
