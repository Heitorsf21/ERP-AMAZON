import { beforeEach, describe, expect, it, vi } from "vitest";
import { EstoqueFiltroOperacional } from "./filtros";

const mockDb = vi.hoisted(() => ({
  produto: {
    findMany: vi.fn(),
  },
  produtoCustoHistorico: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  calcularResumoEstoque,
  estoqueRepository,
  montarWhereProdutos,
  resolverCustosVigentesProdutos,
} from "./repository";

describe("estoque repository filtros operacionais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("monta filtro padrão de ativos MFS com estoque operacional", () => {
    expect(
      montarWhereProdutos({
        ativo: true,
        estoque: EstoqueFiltroOperacional.COM_ESTOQUE,
      }),
    ).toEqual({
      AND: [
        { ativo: true },
        { sku: { startsWith: "MFS-" } },
        {
          OR: [
            { amazonEstoqueDisponivel: { gt: 0 } },
            { estoqueAtual: { gt: 0 } },
          ],
        },
      ],
    });
  });

  it("monta filtro de sem estoque e sem sync Amazon", () => {
    expect(
      montarWhereProdutos({
        ativo: true,
        estoque: EstoqueFiltroOperacional.SEM_ESTOQUE,
        semSyncAmazon: true,
      }),
    ).toEqual({
      AND: [
        { ativo: true },
        { sku: { startsWith: "MFS-" } },
        {
          estoqueAtual: { lte: 0 },
          OR: [
            { amazonEstoqueDisponivel: null },
            { amazonEstoqueDisponivel: { lte: 0 } },
          ],
        },
        { amazonEstoqueDisponivel: null },
      ],
    });
  });
});

describe("estoque repository resumo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const produtos = [
    {
      id: "p1",
      ativo: true,
      estoqueAtual: 8,
      estoqueMinimo: 4,
      custoUnitario: 1000,
      amazonEstoqueDisponivel: 4,
      amazonPrecoListagemCentavos: 5000,
      precoVenda: 4500,
    },
    {
      id: "p2",
      ativo: true,
      estoqueAtual: 3,
      estoqueMinimo: 5,
      custoUnitario: null,
      amazonEstoqueDisponivel: 3,
      amazonPrecoListagemCentavos: null,
      precoVenda: 7000,
    },
    {
      id: "p3",
      ativo: true,
      estoqueAtual: 2,
      estoqueMinimo: 0,
      custoUnitario: 500,
      amazonEstoqueDisponivel: null,
      amazonPrecoListagemCentavos: 3000,
      precoVenda: null,
    },
    {
      id: "p4",
      ativo: false,
      estoqueAtual: 1,
      estoqueMinimo: 2,
      custoUnitario: 800,
      amazonEstoqueDisponivel: 2,
      amazonPrecoListagemCentavos: null,
      precoVenda: null,
    },
  ];

  it("calcula custo por quantidade vendavel e receita potencial por preco", () => {
    const resumo = calcularResumoEstoque(
      produtos,
      new Map([
        ["p1", 1000],
        ["p2", 2200],
        ["p3", 500],
        ["p4", 800],
      ]),
    );

    expect(resumo.total).toBe(4);
    expect(resumo.inativos).toBe(1);
    expect(resumo.unidadesVendaveis).toBe(11);
    expect(resumo.custoEstoqueCentavos).toBe(
      4 * 1000 + 3 * 2200 + 2 * 500 + 2 * 800,
    );
    expect(resumo.valorTotalCentavos).toBe(resumo.custoEstoqueCentavos);
    expect(resumo.receitaPotencialCentavos).toBe(
      4 * 5000 + 3 * 7000 + 2 * 3000,
    );
    expect(resumo.produtosSemPreco).toBe(1);
    expect(resumo.produtosSemSyncAmazon).toBe(1);
    expect(resumo.countRepor).toBe(2);
  });

  it("resolve custo vigente por histórico e cai para Produto.custoUnitario", async () => {
    const dataReferencia = new Date("2026-05-27T12:00:00.000Z");
    mockDb.produtoCustoHistorico.findMany.mockResolvedValue([
      {
        produtoId: "p2",
        custoCentavos: 2200,
        vigenciaInicio: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const custos = await resolverCustosVigentesProdutos(produtos, dataReferencia);

    expect(mockDb.produtoCustoHistorico.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          produtoId: { in: ["p1", "p2", "p3", "p4"] },
          vigenciaInicio: { lte: dataReferencia },
        }),
      }),
    );
    expect(custos.get("p1")).toBe(1000);
    expect(custos.get("p2")).toBe(2200);
    expect(custos.get("p3")).toBe(500);
  });

  it("aplica filtro sem custo ao resumo do endpoint", async () => {
    mockDb.produto.findMany.mockResolvedValue(produtos);
    mockDb.produtoCustoHistorico.findMany.mockResolvedValue([]);

    const resumo = await estoqueRepository.totais({
      ativo: true,
      estoque: EstoqueFiltroOperacional.COM_ESTOQUE,
      semCusto: true,
    });

    expect(resumo.total).toBe(1);
    expect(resumo.produtosSemCusto).toBe(1);
    expect(resumo.custoEstoqueCentavos).toBe(0);
  });
});
