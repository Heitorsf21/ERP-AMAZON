import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    vendaAmazon: {
      groupBy: vi.fn(),
    },
    notificacao: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    produto: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

describe("sincronizarCustoAusente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marca notificacoes de custo ausente como lidas quando nao ha pendencias", async () => {
    const { sincronizarCustoAusente } = await import("./service");
    dbMock.vendaAmazon.groupBy.mockResolvedValue([]);
    dbMock.notificacao.updateMany.mockResolvedValue({ count: 2 });

    const resultado = await sincronizarCustoAusente(
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(resultado).toEqual({
      pendentes: 0,
      criada: false,
      atualizada: false,
      resolvida: true,
    });
    expect(dbMock.notificacao.updateMany).toHaveBeenCalledWith({
      where: { tipo: "CUSTO_AUSENTE", lida: false },
      data: { lida: true },
    });
    expect(dbMock.notificacao.create).not.toHaveBeenCalled();
    expect(dbMock.notificacao.update).not.toHaveBeenCalled();
  });

  it("atualiza a notificacao do dia quando ainda ha vendas sem custo", async () => {
    const { sincronizarCustoAusente } = await import("./service");
    dbMock.vendaAmazon.groupBy.mockResolvedValue([
      { sku: "SKU-MAIS", _count: { id: 3 } },
      { sku: "SKU-MENOS", _count: { id: 1 } },
    ]);
    dbMock.notificacao.updateMany.mockResolvedValue({ count: 1 });
    dbMock.produto.findMany.mockResolvedValue([
      { sku: "SKU-MAIS", nome: "Produto Mais" },
      { sku: "SKU-MENOS", nome: "Produto Menos" },
    ]);
    dbMock.notificacao.findFirst.mockResolvedValue({ id: "notif-1" });
    dbMock.notificacao.update.mockResolvedValue({});

    const resultado = await sincronizarCustoAusente(
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(resultado).toMatchObject({
      pendentes: 2,
      criada: false,
      atualizada: true,
      resolvida: false,
    });
    expect(dbMock.notificacao.update).toHaveBeenCalledWith({
      where: { id: "notif-1" },
      data: expect.objectContaining({
        titulo: "2 produtos sem custo cadastrado",
        descricao: "Margem e lucro nao calculados para: SKU-MAIS, SKU-MENOS",
        linkRef: "/produtos",
        lida: false,
      }),
    });
    expect(dbMock.notificacao.create).not.toHaveBeenCalled();
  });
});
