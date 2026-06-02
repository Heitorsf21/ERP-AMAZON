import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    produto: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    produtoCustoHistorico: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    vendaAmazon: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

describe("custo historico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolve custo por fallback com select tenant-safe", async () => {
    const { resolverCustoUnitario } = await import("./custo-historico");
    dbMock.produtoCustoHistorico.findFirst.mockResolvedValue(null);
    dbMock.produto.findUnique.mockResolvedValue({
      empresaId: "empresa-1",
      custoUnitario: 1299,
    });

    const custo = await resolverCustoUnitario(
      "produto-1",
      new Date("2026-05-10T12:00:00.000Z"),
    );

    expect(custo).toBe(1299);
    expect(dbMock.produto.findUnique).toHaveBeenCalledWith({
      where: { id: "produto-1" },
      select: { empresaId: true, custoUnitario: true },
    });
  });

  it("reaplica custo em vendas sem tocar campos financeiros sagrados", async () => {
    const { reaplicarCustoEmVendas } = await import("./custo-historico");
    const dataVenda = new Date("2026-05-10T12:00:00.000Z");
    dbMock.produto.findUnique.mockResolvedValue({
      empresaId: "empresa-1",
      sku: "SKU-1",
    });
    dbMock.vendaAmazon.findMany.mockResolvedValue([
      {
        id: "venda-1",
        sku: "SKU-1",
        dataVenda,
        custoUnitarioCentavos: null,
      },
    ]);
    dbMock.produto.findMany.mockResolvedValue([{ id: "produto-1", sku: "SKU-1" }]);
    dbMock.produtoCustoHistorico.findFirst.mockResolvedValue({
      custoCentavos: 250,
    });
    dbMock.vendaAmazon.update.mockResolvedValue({});

    const resultado = await reaplicarCustoEmVendas({ produtoId: "produto-1" });

    expect(resultado).toEqual({ atualizadas: 1, semProdutoMapeado: 0 });
    expect(dbMock.produto.findUnique).toHaveBeenCalledWith({
      where: { id: "produto-1" },
      select: { empresaId: true, sku: true },
    });
    expect(dbMock.vendaAmazon.update).toHaveBeenCalledWith({
      where: { id: "venda-1" },
      data: { custoUnitarioCentavos: 250, ultimaSyncEm: expect.any(Date) },
    });
    expect(dbMock.vendaAmazon.update.mock.calls[0]?.[0].data).not.toHaveProperty(
      "taxasCentavos",
    );
    expect(dbMock.vendaAmazon.update.mock.calls[0]?.[0].data).not.toHaveProperty(
      "fretesCentavos",
    );
    expect(dbMock.vendaAmazon.update.mock.calls[0]?.[0].data).not.toHaveProperty(
      "liquidoMarketplaceCentavos",
    );
  });
});
