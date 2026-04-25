import { parse } from "csv-parse/sync";
import { parseValorBRParaCentavos } from "../../lib/money";
import type { AmazonReembolso, VendaAmazon } from "./importer.contract";

export const AmazonTransactionStatus = {
  LIBERADO: "LIBERADO",
  DIFERIDO: "DIFERIDO",
  DESCONHECIDO: "DESCONHECIDO",
} as const;
export type AmazonTransactionStatus =
  (typeof AmazonTransactionStatus)[keyof typeof AmazonTransactionStatus];

export type AmazonUnifiedTransaction = {
  dataHoraOriginal: string;
  dataHora: Date | null;
  idLiquidacao: string;
  tipo: string;
  idPedido: string;
  sku: string;
  descricao: string;
  quantidade: number;
  mercado: string;
  atendimento: string;
  vendasProdutoCentavos: number;
  creditosRemessaCentavos: number;
  creditosEmbalagemPresenteCentavos: number;
  descontosPromocionaisCentavos: number;
  impostoVendasColetadosCentavos: number;
  tarifasVendaCentavos: number;
  taxasFbaCentavos: number;
  taxasOutrasTransacoesCentavos: number;
  outroCentavos: number;
  totalCentavos: number;
  statusTransacao: string;
  statusNormalizado: AmazonTransactionStatus;
  dataLiberacaoOriginal: string;
  dataLiberacao: Date | null;
};

export type AmazonUnifiedTransactionParseResult = {
  headerLine: number;
  transactions: AmazonUnifiedTransaction[];
};

export type AmazonResumoAgrupado = {
  linhas: number;
  totalCentavos: number;
};

export type AmazonResumoSku = {
  sku: string;
  linhas: number;
  quantidade: number;
  brutoCentavos: number;
  taxasCentavos: number;
  liquidoCentavos: number;
};

export type AmazonUnifiedTransactionResumo = {
  totalLinhas: number;
  pedidos: {
    linhas: number;
    pedidosUnicos: number;
    skusUnicos: number;
    quantidade: number;
    brutoCentavos: number;
    descontosPromocionaisCentavos: number;
    tarifasVendaCentavos: number;
    taxasFbaCentavos: number;
    taxasOutrasTransacoesCentavos: number;
    liquidoCentavos: number;
  };
  recebiveis: {
    liberadoCentavos: number;
    diferidoCentavos: number;
    transferidoBancoCentavos: number;
    atividadeAntesTransferenciaCentavos: number;
    saldoRelatorioCentavos: number;
  };
  porStatus: Record<AmazonTransactionStatus, AmazonResumoAgrupado>;
  porTipo: Record<string, AmazonResumoAgrupado>;
  porSku: AmazonResumoSku[];
};

const COLUNAS = {
  dataHora: ["data/hora", "date/time"],
  idLiquidacao: ["id de liquidacao", "settlement-id", "settlement id"],
  tipo: ["tipo", "type", "transaction-type"],
  idPedido: ["id do pedido", "order-id", "order id"],
  sku: ["sku"],
  descricao: ["descricao", "description"],
  quantidade: ["quantidade", "quantity", "quantity-purchased"],
  mercado: ["mercado", "store", "marketplace-name"],
  atendimento: ["atendimento", "fulfillment", "fulfillment-id"],
  vendasProduto: ["vendas do produto", "product-sales"],
  creditosRemessa: ["creditos de remessa", "shipping-credits"],
  creditosEmbalagemPresente: [
    "creditos de embalagem de presente",
    "gift-wrap-credits",
  ],
  descontosPromocionais: ["descontos promocionais", "promotional-rebate"],
  impostoVendasColetados: [
    "imposto de vendas coletados",
    "product-sales-tax",
    "tax amount",
  ],
  tarifasVenda: ["tarifas de venda", "selling-fees"],
  taxasFba: ["taxas fba", "fba-fees"],
  taxasOutrasTransacoes: [
    "taxas de outras transacoes",
    "other-transaction-fees",
  ],
  outro: ["outro", "other"],
  total: ["total", "total amount"],
  statusTransacao: ["status da transacao", "transaction status"],
  dataLiberacao: [
    "data de liberacao da transacao",
    "transaction release date",
  ],
} as const;

const MESES_PT = new Map([
  ["jan", 0],
  ["fev", 1],
  ["mar", 2],
  ["abr", 3],
  ["mai", 4],
  ["jun", 5],
  ["jul", 6],
  ["ago", 7],
  ["set", 8],
  ["out", 9],
  ["nov", 10],
  ["dez", 11],
]);

export function parseAmazonUnifiedTransactionCsv(
  csvText: string,
): AmazonUnifiedTransactionParseResult {
  const rows = parse(csvText, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];

  const headerIndex = rows.findIndex((row) => {
    const cols = row.map(normalizar);
    return cols.includes("data hora") && cols.includes("total");
  });

  if (headerIndex < 0) {
    throw new Error("cabecalho do relatorio Amazon nao encontrado");
  }

  const headers = rows[headerIndex] ?? [];
  const pick = criarLeitorDeLinha(headers);
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim() !== ""));

  const transactions = dataRows.map((row) => ({
    dataHoraOriginal: pick(row, COLUNAS.dataHora),
    dataHora: parseAmazonReportDate(pick(row, COLUNAS.dataHora)),
    idLiquidacao: pick(row, COLUNAS.idLiquidacao),
    tipo: pick(row, COLUNAS.tipo),
    idPedido: pick(row, COLUNAS.idPedido),
    sku: pick(row, COLUNAS.sku),
    descricao: pick(row, COLUNAS.descricao),
    quantidade: parseQuantidade(pick(row, COLUNAS.quantidade)),
    mercado: pick(row, COLUNAS.mercado),
    atendimento: pick(row, COLUNAS.atendimento),
    vendasProdutoCentavos: parseMoeda(pick(row, COLUNAS.vendasProduto)),
    creditosRemessaCentavos: parseMoeda(pick(row, COLUNAS.creditosRemessa)),
    creditosEmbalagemPresenteCentavos: parseMoeda(
      pick(row, COLUNAS.creditosEmbalagemPresente),
    ),
    descontosPromocionaisCentavos: parseMoeda(
      pick(row, COLUNAS.descontosPromocionais),
    ),
    impostoVendasColetadosCentavos: parseMoeda(
      pick(row, COLUNAS.impostoVendasColetados),
    ),
    tarifasVendaCentavos: parseMoeda(pick(row, COLUNAS.tarifasVenda)),
    taxasFbaCentavos: parseMoeda(pick(row, COLUNAS.taxasFba)),
    taxasOutrasTransacoesCentavos: parseMoeda(
      pick(row, COLUNAS.taxasOutrasTransacoes),
    ),
    outroCentavos: parseMoeda(pick(row, COLUNAS.outro)),
    totalCentavos: parseMoeda(pick(row, COLUNAS.total)),
    statusTransacao: pick(row, COLUNAS.statusTransacao),
    statusNormalizado: normalizarStatus(pick(row, COLUNAS.statusTransacao)),
    dataLiberacaoOriginal: pick(row, COLUNAS.dataLiberacao),
    dataLiberacao: parseAmazonReportDate(pick(row, COLUNAS.dataLiberacao)),
  }));

  return { headerLine: headerIndex + 1, transactions };
}

export function resumirAmazonUnifiedTransactions(
  transactions: AmazonUnifiedTransaction[],
): AmazonUnifiedTransactionResumo {
  const pedidos = transactions.filter(isPedido);
  const transferencias = transactions.filter(isTransferencia);
  const antesTransferencia = transactions.filter((tx) => !isTransferencia(tx));

  const pedidosUnicos = new Set(pedidos.map((tx) => tx.idPedido).filter(Boolean));
  const skusUnicos = new Set(pedidos.map((tx) => tx.sku).filter(Boolean));

  return {
    totalLinhas: transactions.length,
    pedidos: {
      linhas: pedidos.length,
      pedidosUnicos: pedidosUnicos.size,
      skusUnicos: skusUnicos.size,
      quantidade: somar(pedidos, (tx) => tx.quantidade),
      brutoCentavos: somar(pedidos, valorBrutoDaVenda),
      descontosPromocionaisCentavos: somar(
        pedidos,
        (tx) => tx.descontosPromocionaisCentavos,
      ),
      tarifasVendaCentavos: somar(pedidos, (tx) => tx.tarifasVendaCentavos),
      taxasFbaCentavos: somar(pedidos, (tx) => tx.taxasFbaCentavos),
      taxasOutrasTransacoesCentavos: somar(
        pedidos,
        (tx) => tx.taxasOutrasTransacoesCentavos,
      ),
      liquidoCentavos: somar(pedidos, (tx) => tx.totalCentavos),
    },
    recebiveis: {
      liberadoCentavos: somar(
        antesTransferencia.filter(
          (tx) => tx.statusNormalizado === AmazonTransactionStatus.LIBERADO,
        ),
        (tx) => tx.totalCentavos,
      ),
      diferidoCentavos: somar(
        antesTransferencia.filter(
          (tx) => tx.statusNormalizado === AmazonTransactionStatus.DIFERIDO,
        ),
        (tx) => tx.totalCentavos,
      ),
      transferidoBancoCentavos: Math.abs(
        somar(transferencias, (tx) => tx.totalCentavos),
      ),
      atividadeAntesTransferenciaCentavos: somar(
        antesTransferencia,
        (tx) => tx.totalCentavos,
      ),
      saldoRelatorioCentavos: somar(transactions, (tx) => tx.totalCentavos),
    },
    porStatus: agruparPorStatus(transactions),
    porTipo: agruparPorTipo(transactions),
    porSku: agruparPorSku(pedidos),
  };
}

export function converterParaVendasAmazon(
  transactions: AmazonUnifiedTransaction[],
  options: { somenteLiberadas?: boolean } = {},
): VendaAmazon[] {
  return transactions
    .filter(isPedido)
    .filter((tx) =>
      options.somenteLiberadas
        ? tx.statusNormalizado === AmazonTransactionStatus.LIBERADO
        : true,
    )
    .map((tx) => {
      if (!tx.dataHora) {
        throw new Error(`data invalida no pedido Amazon ${tx.idPedido}`);
      }

      const valorBrutoCentavos = valorBrutoDaVenda(tx);
      const faturamentoCentavos = Math.max(0, tx.vendasProdutoCentavos);
      const precoUnitarioCentavos =
        tx.quantidade > 0
          ? Math.round(faturamentoCentavos / tx.quantidade)
          : faturamentoCentavos;
      const taxasCentavos =
        Math.abs(tx.tarifasVendaCentavos) +
        Math.abs(tx.taxasOutrasTransacoesCentavos);
      const fretesCentavos = Math.abs(tx.taxasFbaCentavos);
      const liquidoMarketplaceCentavos = tx.totalCentavos;

      return {
        amazonOrderId:
          tx.idPedido || `${tx.idLiquidacao}:${tx.dataHoraOriginal}:${tx.sku}`,
        sku: tx.sku,
        titulo: tx.descricao || undefined,
        quantidade: tx.quantidade,
        precoUnitarioCentavos,
        valorBrutoCentavos,
        taxasCentavos,
        fretesCentavos,
        liquidoMarketplaceCentavos,
        liquidacaoId: tx.idLiquidacao || undefined,
        fulfillmentChannel: tx.atendimento || undefined,
        statusPedido: "ORDERED",
        statusFinanceiro: tx.statusNormalizado,
        dataVenda: tx.dataHora,
        marketplace: tx.mercado || "amazon.com.br",
        referenciaExterna:
          tx.idPedido || `${tx.idLiquidacao}:${tx.dataHoraOriginal}:${tx.sku}`,
      };
    });
}

export function converterParaReembolsosAmazon(
  transactions: AmazonUnifiedTransaction[],
): AmazonReembolso[] {
  return transactions.filter(isReembolso).map((tx) => {
    if (!tx.dataHora) {
      throw new Error(`data invalida no reembolso Amazon ${tx.idPedido}`);
    }

    const valorReembolsadoCentavos = Math.abs(
      tx.totalCentavos || valorBrutoDaVenda(tx),
    );
    const taxasReembolsadasCentavos =
      Math.abs(tx.tarifasVendaCentavos) +
      Math.abs(tx.taxasFbaCentavos) +
      Math.abs(tx.taxasOutrasTransacoesCentavos);
    const fallbackId = `${tx.idLiquidacao}:${tx.dataHoraOriginal}:${tx.sku}`;

    return {
      amazonOrderId: tx.idPedido || fallbackId,
      sku: tx.sku,
      titulo: tx.descricao || undefined,
      quantidade: Math.abs(tx.quantidade) || 1,
      valorReembolsadoCentavos,
      taxasReembolsadasCentavos,
      dataReembolso: tx.dataHora,
      liquidacaoId: tx.idLiquidacao || undefined,
      marketplace: tx.mercado || "amazon.com.br",
      referenciaExterna: `${tx.idPedido || fallbackId}:${tx.dataHoraOriginal}:${
        tx.sku || "sem-sku"
      }:refund`,
      statusFinanceiro: tx.statusNormalizado,
    };
  });
}

export function parseAmazonReportDate(value: string): Date | null {
  const texto = value.trim();
  if (!texto) return null;

  const parsed = Date.parse(texto);
  if (Number.isFinite(parsed)) return new Date(parsed);

  const match = texto.match(
    /^(\d{1,2}) de ([\p{L}.]+) de (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT([+-]\d{1,2})(?::?(\d{2}))?$/iu,
  );
  if (!match) return null;

  const [, dia, mesRaw, ano, hora, minuto, segundo, offsetHora, offsetMinuto] =
    match;
  if (!dia || !mesRaw || !ano || !hora || !minuto || !segundo || !offsetHora) {
    return null;
  }

  const mes = MESES_PT.get(normalizar(mesRaw).replace(/\s/g, ""));
  if (mes == null) return null;

  const offsetSinal = offsetHora.startsWith("-") ? -1 : 1;
  const offsetHoras = Number(offsetHora);
  const offsetMinutos = Number(offsetMinuto ?? "0") * offsetSinal;
  const utcMs = Date.UTC(
    Number(ano),
    mes,
    Number(dia),
    Number(hora) - offsetHoras,
    Number(minuto) - offsetMinutos,
    Number(segundo),
  );

  return new Date(utcMs);
}

function criarLeitorDeLinha(headers: string[]) {
  const indexes = new Map<string, number>();
  headers.forEach((header, index) => indexes.set(normalizar(header), index));

  return (row: string[], aliases: readonly string[]): string => {
    const index = aliases
      .map((alias) => indexes.get(normalizar(alias)))
      .find((value) => value != null);

    if (index == null) return "";
    return row[index]?.trim() ?? "";
  };
}

function normalizar(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoeda(value: string): number {
  if (!value.trim()) return 0;
  return parseValorBRParaCentavos(value);
}

function parseQuantidade(value: string): number {
  if (!value.trim()) return 0;
  const quantidade = Number(value.replace(",", "."));
  return Number.isFinite(quantidade) ? quantidade : 0;
}

function normalizarStatus(value: string): AmazonTransactionStatus {
  const status = normalizar(value);
  if (status === "liberado" || status === "released") {
    return AmazonTransactionStatus.LIBERADO;
  }
  if (status === "diferido" || status === "deferred") {
    return AmazonTransactionStatus.DIFERIDO;
  }
  return AmazonTransactionStatus.DESCONHECIDO;
}

function isPedido(tx: AmazonUnifiedTransaction): boolean {
  return normalizar(tx.tipo) === "pedido" || normalizar(tx.tipo) === "order";
}

function isReembolso(tx: AmazonUnifiedTransaction): boolean {
  const tipo = normalizar(tx.tipo);
  return tipo === "reembolso" || tipo === "refund";
}

function isTransferencia(tx: AmazonUnifiedTransaction): boolean {
  return (
    normalizar(tx.tipo) === "transferir" || normalizar(tx.tipo) === "transfer"
  );
}

function valorBrutoDaVenda(tx: AmazonUnifiedTransaction): number {
  return (
    tx.vendasProdutoCentavos +
    tx.creditosRemessaCentavos +
    tx.creditosEmbalagemPresenteCentavos +
    tx.impostoVendasColetadosCentavos
  );
}

function somar<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((acc, item) => acc + getValue(item), 0);
}

function agruparPorStatus(
  transactions: AmazonUnifiedTransaction[],
): Record<AmazonTransactionStatus, AmazonResumoAgrupado> {
  const resumo = {
    [AmazonTransactionStatus.LIBERADO]: { linhas: 0, totalCentavos: 0 },
    [AmazonTransactionStatus.DIFERIDO]: { linhas: 0, totalCentavos: 0 },
    [AmazonTransactionStatus.DESCONHECIDO]: { linhas: 0, totalCentavos: 0 },
  };

  for (const tx of transactions) {
    const grupo = resumo[tx.statusNormalizado];
    grupo.linhas += 1;
    grupo.totalCentavos += tx.totalCentavos;
  }

  return resumo;
}

function agruparPorTipo(
  transactions: AmazonUnifiedTransaction[],
): Record<string, AmazonResumoAgrupado> {
  const resumo: Record<string, AmazonResumoAgrupado> = {};
  for (const tx of transactions) {
    const tipo = tx.tipo || "(sem tipo)";
    resumo[tipo] ??= { linhas: 0, totalCentavos: 0 };
    resumo[tipo].linhas += 1;
    resumo[tipo].totalCentavos += tx.totalCentavos;
  }
  return resumo;
}

function agruparPorSku(
  pedidos: AmazonUnifiedTransaction[],
): AmazonResumoSku[] {
  const resumo: Record<string, AmazonResumoSku> = {};
  for (const tx of pedidos) {
    const sku = tx.sku || "(sem sku)";
    resumo[sku] ??= {
      sku,
      linhas: 0,
      quantidade: 0,
      brutoCentavos: 0,
      taxasCentavos: 0,
      liquidoCentavos: 0,
    };

    const grupo = resumo[sku];
    const brutoCentavos = valorBrutoDaVenda(tx);
    grupo.linhas += 1;
    grupo.quantidade += tx.quantidade;
    grupo.brutoCentavos += brutoCentavos;
    grupo.taxasCentavos += Math.max(0, brutoCentavos - tx.totalCentavos);
    grupo.liquidoCentavos += tx.totalCentavos;
  }

  return Object.values(resumo).sort(
    (a, b) => b.liquidoCentavos - a.liquidoCentavos,
  );
}
