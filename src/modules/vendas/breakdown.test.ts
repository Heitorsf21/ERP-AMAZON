import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` garante que o objeto mock existe ANTES do vi.mock ser executado
// (vi.mock é hoisted para o topo do módulo pelo Vitest).
const mockDb = vi.hoisted(() => ({
  produto: { findMany: vi.fn() },
  amazonFinanceTransaction: { findMany: vi.fn() },
  produtoCustoHistorico: { findMany: vi.fn() },
  configuracaoSistema: { findMany: vi.fn() },
  amazonFeeEstimate: { findUnique: vi.fn() },
  vendaCustoEventual: { findMany: vi.fn() },
  amazonAdsMetricaDiaria: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mocks dos módulos de config para isolar do estado real e do TTL.
vi.mock("@/modules/configuracao/imposto-simples", () => ({
  getConfigImpostoSimples: vi.fn(async () => ({ aliquotaBps: 600, ativo: true })),
}));

vi.mock("@/modules/produtos/fee-estimator", async () => {
  const real = await vi.importActual<typeof import("@/modules/produtos/fee-estimator")>(
    "@/modules/produtos/fee-estimator",
  );
  return {
    ...real,
    loadFeeEstimatorConfig: vi.fn(async () => ({
      referralDefaultBps: 1200,
      fbaPromoAtiva: true,
      fbaPromoExpiraEm: new Date("2099-12-31"),
      fbaPromoUnder100Centavos: 500,
      fbaPromoOver100Centavos: 0,
      fbaFallbackPosPromoCentavos: 1005,
    })),
  };
});

// Importação após os mocks
import { montarBreakdownVendas, type VendaParaBreakdown } from "./breakdown";

const SKU_OK = "MFS-0036";
const ORDER_ID = "702-5847780-7813817";
const DATA_VENDA = new Date("2026-05-13T22:03:36Z");

function vendaBase(overrides: Partial<VendaParaBreakdown> = {}): VendaParaBreakdown {
  return {
    id: "venda-1",
    amazonOrderId: ORDER_ID,
    orderItemId: null,
    sku: SKU_OK,
    asin: "B07RZQYW3X",
    dataVenda: DATA_VENDA,
    quantidade: 1,
    precoUnitarioCentavos: 7999,
    valorBrutoCentavos: 7999,
    taxasCentavos: 0,
    fretesCentavos: 0,
    liquidoMarketplaceCentavos: null,
    statusPedido: "Pending",
    statusFinanceiro: "PENDENTE",
    ...overrides,
  };
}

function shipmentPayload(opts: {
  sku?: string;
  commission?: number;
  fba?: number;
  parcelamento?: number;
  closing?: number;
  shippingCharge?: number;
  shippingChargeback?: number;
  shippingDiscount?: number;
}): string {
  const subs: unknown[] = [];
  if (opts.commission != null) {
    subs.push({
      breakdownType: "Commission",
      breakdownAmount: { currencyAmount: opts.commission },
    });
  }
  if (opts.fba != null) {
    subs.push({
      breakdownType: "FBAFulfillmentFee",
      breakdownAmount: { currencyAmount: opts.fba },
    });
  }
  if (opts.parcelamento != null) {
    subs.push({
      breakdownType: "AmazonForAllFee",
      breakdownAmount: { currencyAmount: opts.parcelamento },
    });
  }
  if (opts.closing != null) {
    subs.push({
      breakdownType: "ClosingFee",
      breakdownAmount: { currencyAmount: opts.closing },
    });
  }

  const top: unknown[] = [
    {
      breakdownType: "AmazonFees",
      breakdownAmount: { currencyAmount: -0 },
      breakdowns: subs,
    },
  ];
  if (opts.shippingCharge != null) {
    top.push({
      breakdownType: "ShippingCharge",
      breakdownAmount: { currencyAmount: opts.shippingCharge },
    });
  }
  if (opts.shippingChargeback != null) {
    top.push({
      breakdownType: "ShippingChargeback",
      breakdownAmount: { currencyAmount: opts.shippingChargeback },
    });
  }
  if (opts.shippingDiscount != null) {
    top.push({
      breakdownType: "PromoRebates",
      breakdownAmount: { currencyAmount: opts.shippingDiscount },
      breakdowns: [
        {
          breakdownType: "ShippingDiscount",
          breakdownAmount: { currencyAmount: opts.shippingDiscount },
        },
      ],
    });
  }

  return JSON.stringify({
    transactionType: "Shipment",
    items: [{ sku: opts.sku ?? SKU_OK, breakdowns: top }],
  });
}

beforeEach(() => {
  for (const mock of Object.values(mockDb)) {
    for (const fn of Object.values(mock)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }

  // Defaults sãos: nenhum produto, nenhuma transação, nenhuma vigência.
  mockDb.produto.findMany.mockResolvedValue([]);
  mockDb.amazonFinanceTransaction.findMany.mockResolvedValue([]);
  mockDb.produtoCustoHistorico.findMany.mockResolvedValue([]);
  mockDb.vendaCustoEventual.findMany.mockResolvedValue([]);
  mockDb.amazonAdsMetricaDiaria.findMany.mockResolvedValue([]);
});

describe("montarBreakdownVendas · settled (com Finance payload)", () => {
  it("extrai sub-fees desagregadas e calcula lucro corretamente", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-1",
        sku: SKU_OK,
        asin: "B07RZQYW3X",
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: "cozinha",
        custoUnitario: 3840,
      },
    ]);

    mockDb.amazonFinanceTransaction.findMany.mockResolvedValue([
      {
        amazonOrderId: ORDER_ID,
        transactionType: "Shipment",
        payload: shipmentPayload({
          commission: -9.6,
          fba: -5.0,
          parcelamento: -1.2,
          shippingCharge: 4.1,
          shippingChargeback: -4.1,
        }),
      },
    ]);

    const venda = vendaBase({
      taxasCentavos: 1580,
      fretesCentavos: 410,
      statusPedido: "Shipped",
      statusFinanceiro: "LIQUIDADO",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.origem).toBe("settled");
    expect(b.totalItensCentavos).toBe(7999);
    expect(b.comissaoCentavos).toBe(960);
    expect(b.taxaFbaCentavos).toBe(500);
    expect(b.taxaParcelamentoCentavos).toBe(120);
    expect(b.freteRecebidoCentavos).toBe(410);
    expect(b.fretePagoCentavos).toBe(410);
    expect(b.custoProdutoCentavos).toBe(3840);
    // imposto 6% sobre 79.99 = 4.7994 → arredondado 480
    expect(b.impostoCentavos).toBe(480);
    // 7999 + 410 - 410 - 960 - 500 - 120 - 0 - 0 - 480 - 3840 = 2099
    expect(b.lucroCentavos).toBe(2099);
    expect(b.margemBps).toBe(2624);
  });

  it("usa taxasCentavos agregado como taxas nao detalhadas quando nao ha payload Finance", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-2",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 2000,
      },
    ]);
    // Sem transação para esse orderId

    const venda = vendaBase({
      taxasCentavos: 1500,
      fretesCentavos: 0,
      statusPedido: "Shipped",
      statusFinanceiro: "LIQUIDADO",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.origem).toBe("settled");
    expect(b.comissaoCentavos).toBe(0);
    expect(b.taxaFbaCentavos).toBe(0);
    expect(b.taxaParcelamentoCentavos).toBe(0);
    expect(b.taxasAmazonNaoDetalhadasCentavos).toBe(1500);
    // 7999 - 1500 - imposto(480) - custo(2000)
    expect(b.lucroCentavos).toBe(4019);
  });

  it("mantem frete recebido como receita na conciliacao Amazon", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-ship",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 2000,
      },
    ]);
    mockDb.amazonFinanceTransaction.findMany.mockResolvedValue([
      {
        amazonOrderId: ORDER_ID,
        transactionType: "Shipment",
        payload: shipmentPayload({
          commission: -9.6,
          fba: -5,
          shippingCharge: 4.1,
        }),
      },
    ]);

    const venda = vendaBase({
      taxasCentavos: 1460,
      statusPedido: "Shipped",
      statusFinanceiro: "LIQUIDADO",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.freteRecebidoCentavos).toBe(410);
    expect(b.fretePagoCentavos).toBe(0);
    // 7999 + 410 - 960 - 500 - imposto(480) - custo(2000)
    expect(b.lucroCentavos).toBe(4469);
  });

  it("classifica ShippingDiscount como desconto de frete sem alterar o lucro real", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-ship-discount",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 2000,
      },
    ]);
    mockDb.amazonFinanceTransaction.findMany.mockResolvedValue([
      {
        amazonOrderId: ORDER_ID,
        transactionType: "Shipment",
        payload: shipmentPayload({
          commission: -4,
          fba: -5,
          parcelamento: -1.2,
          shippingCharge: 8.9,
          shippingDiscount: -8.9,
        }),
      },
    ]);

    const venda = vendaBase({
      taxasCentavos: 1020,
      fretesCentavos: 890,
      statusPedido: "Shipped",
      statusFinanceiro: "LIQUIDADO",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.freteRecebidoCentavos).toBe(890);
    expect(b.descontoFreteCentavos).toBe(890);
    expect(b.promoRebatesCentavos).toBe(0);
    // Mesmo resultado de uma venda sem frete, pois ShippingDiscount anula Shipping.
    expect(b.lucroCentavos).toBe(4499);
  });
});

describe("montarBreakdownVendas · estimated (pendente sem Finance)", () => {
  it("usa calcularFeesLocal com a categoria do produto", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-3",
        sku: SKU_OK,
        asin: "B07RZQYW3X",
        amazonImagemUrl: "https://example.com/img.jpg",
        imagemUrl: null,
        amazonCategoriaFee: "cozinha", // 12% rate, min 200
        custoUnitario: 3840,
      },
    ]);

    const venda = vendaBase({
      taxasCentavos: 0,
      fretesCentavos: 0,
      statusPedido: "Pending",
      statusFinanceiro: "PENDENTE",
    });

    const { breakdownPorVenda, produtoPorSku } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.origem).toBe("estimated");
    // cozinha = 12% de 79.99 = 9.5988 → 960 centavos
    expect(b.comissaoCentavos).toBe(960);
    expect(b.taxaFbaCentavos).toBe(500); // promo under 100
    expect(b.taxaParcelamentoCentavos).toBe(0); // não estimável
    expect(b.categoriaTaxaSlug).toBe("cozinha");
    expect(b.categoriaTaxaLabel).toBe("Cozinha");
    expect(produtoPorSku.get(SKU_OK)?.amazonImagemUrl).toBe("https://example.com/img.jpg");
  });

  it("FBA per-unit: 3 un × R$41,57 (unit < R$100, total > R$100) → 3 × R$5", async () => {
    // Reproduz o caso real do pedido 701-2310526-4297041 reportado pelo usuário.
    // Antes do fix: total > R$100 → fbaCentavos=0; depois × qty=3 = 0 (errado).
    // Após o fix: avalia preço UNITÁRIO (R$41,57 < R$100) → R$5 × 3 = R$15.
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-multi",
        sku: SKU_OK,
        asin: "B0GNTK1NRD",
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 2560,
      },
    ]);

    const venda = vendaBase({
      quantidade: 3,
      precoUnitarioCentavos: 4157,
      valorBrutoCentavos: 12471,
      taxasCentavos: 0,
      fretesCentavos: 0,
      statusPedido: "Pending",
      statusFinanceiro: "PENDENTE",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.origem).toBe("estimated");
    expect(b.totalItensCentavos).toBe(12471);
    expect(b.taxaFbaCentavos).toBe(1500); // 3 × R$5 (unit R$41,57 < R$100)
    expect(b.comissaoCentavos).toBe(1497); // 12% de R$124,71
    expect(b.custoProdutoCentavos).toBe(7680); // 3 × R$25,60
  });

  it("FBA per-unit: 3 un × R$120 (unit ≥ R$100) → 3 × R$0 (isenção total)", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-high",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 5000,
      },
    ]);

    const venda = vendaBase({
      quantidade: 3,
      precoUnitarioCentavos: 12000,
      valorBrutoCentavos: 36000,
      statusPedido: "Pending",
      statusFinanceiro: "PENDENTE",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.taxaFbaCentavos).toBe(0);
  });

  it("zera frete recebido/pago quando origem é estimada (sem payload)", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-4",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 1000,
      },
    ]);

    const venda = vendaBase();
    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.freteRecebidoCentavos).toBe(0);
    expect(b.fretePagoCentavos).toBe(0);
  });
});

describe("montarBreakdownVendas · no_data", () => {
  it("zera tudo quando venda cancelada sem movimentação financeira", async () => {
    const venda = vendaBase({
      statusPedido: "Canceled",
      statusFinanceiro: "PENDENTE",
      taxasCentavos: 0,
      fretesCentavos: 0,
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.origem).toBe("no_data");
    expect(b.totalItensCentavos).toBe(0);
    expect(b.comissaoCentavos).toBe(0);
    expect(b.lucroCentavos).toBe(0);
    expect(b.impostoCentavos).toBe(0);
  });

  it("não conta venda sem produto correspondente como estimated (no_data)", async () => {
    mockDb.produto.findMany.mockResolvedValue([]); // SKU não cadastrado

    const venda = vendaBase();
    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.origem).toBe("no_data");
    expect(b.custoProdutoCentavos).toBe(0);
  });
});

describe("montarBreakdownVendas · custos eventuais", () => {
  it("soma valorCentavos de VendaCustoEventual em custoExtraCentavos e desconta do lucro", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-ext",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 2000,
      },
    ]);
    mockDb.vendaCustoEventual.findMany.mockResolvedValue([
      {
        id: "ce-1",
        vendaAmazonId: "venda-1",
        descricao: "Frete devolução",
        valorCentavos: 1250,
        criadoEm: new Date("2026-05-19T10:00:00Z"),
      },
      {
        id: "ce-2",
        vendaAmazonId: "venda-1",
        descricao: "Embalagem extra",
        valorCentavos: 500,
        criadoEm: new Date("2026-05-19T11:00:00Z"),
      },
    ]);

    const venda = vendaBase({
      taxasCentavos: 0,
      fretesCentavos: 0,
      statusPedido: "Pending",
      statusFinanceiro: "PENDENTE",
    });

    const { breakdownPorVenda } = await montarBreakdownVendas([venda]);
    const b = breakdownPorVenda.get(venda.id)!;

    expect(b.custoExtraCentavos).toBe(1750);
    expect(b.custosEventuais).toHaveLength(2);
    expect(b.custosEventuais[0]?.descricao).toBe("Frete devolução");

    // Lucro: bruto - fees estimadas - imposto - custo produto - custo extra
    // 7999 - 960 - 500 - 0 - 0 - 0 - 480 - 2000 - 1750 = 2309
    expect(b.lucroCentavos).toBe(2309);
  });
});

describe("montarBreakdownVendas · performance batch", () => {
  it("executa em ≤ 5 queries Prisma para uma página de 50 vendas mistas", async () => {
    mockDb.produto.findMany.mockResolvedValue([
      {
        id: "prod-batch",
        sku: SKU_OK,
        asin: null,
        amazonImagemUrl: null,
        imagemUrl: null,
        amazonCategoriaFee: null,
        custoUnitario: 1000,
      },
    ]);

    const vendas: VendaParaBreakdown[] = Array.from({ length: 50 }, (_, i) =>
      vendaBase({ id: `v-${i}`, amazonOrderId: `${ORDER_ID}-${i}` }),
    );

    await montarBreakdownVendas(vendas);

    expect(mockDb.produto.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.amazonFinanceTransaction.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.produtoCustoHistorico.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.vendaCustoEventual.findMany).toHaveBeenCalledTimes(1);
  });

  it("retorna mapas vazios e não consulta o DB quando lista é vazia", async () => {
    const { breakdownPorVenda, produtoPorSku } = await montarBreakdownVendas([]);
    expect(breakdownPorVenda.size).toBe(0);
    expect(produtoPorSku.size).toBe(0);
    expect(mockDb.produto.findMany).not.toHaveBeenCalled();
  });
});
