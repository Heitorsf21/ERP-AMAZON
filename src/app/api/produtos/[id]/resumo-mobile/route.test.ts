import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmpresaId } from "@/lib/tenant-context";

// Sessão de um usuário da UDN (empresa NÃO primária).
const sessao = vi.hoisted(() => ({
  atual: {
    uid: "u-udn",
    email: "op@udn.test",
    nome: "Operador UDN",
    role: "OPERADOR",
    exp: Math.floor(Date.now() / 1000) + 3600,
    empresaId: "udn",
  } as Record<string, unknown>,
}));

const capturas = vi.hoisted(() => ({ empresaNoImposto: undefined as string | null | undefined }));

const dbMock = vi.hoisted(() => ({
  produto: { findFirst: vi.fn() },
  vendaAmazon: { aggregate: vi.fn() },
  produtoCustoHistorico: { findFirst: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  const exigir = async (...roles: string[]) => {
    const s = sessao.atual;
    if (roles.length > 0 && s.role !== "ADMIN" && !roles.includes(String(s.role))) {
      throw new Response(JSON.stringify({ erro: "SEM_PERMISSAO" }), { status: 403 });
    }
    return s;
  };
  return {
    ...real,
    requireSession: vi.fn(() => exigir()),
    requireRole: vi.fn((...roles: string[]) => exigir(...roles)),
  };
});

vi.mock("@/modules/configuracao/imposto-simples", () => ({
  getConfigImpostoSimples: vi.fn(async () => {
    capturas.empresaNoImposto = getEmpresaId();
    return { aliquotaBps: 600, ativo: true };
  }),
}));

vi.mock("@/modules/produtos/fee-estimator", () => ({
  loadFeeEstimatorConfig: vi.fn(async () => ({})),
  calcularFeesLocal: vi.fn(() => ({ comissaoCentavos: 924, closingFeeCentavos: 0, fbaCentavos: 600 })),
}));

import { GET } from "./route";

const produtoBase = {
  id: "p1",
  sku: "MFS-0001",
  asin: "B000",
  nome: "Kit",
  ativo: true,
  imagemUrl: null,
  amazonImagemUrl: null,
  estoqueAtual: 10,
  amazonEstoqueDisponivel: 10,
  amazonEstoqueInbound: 0,
  amazonEstoqueReservado: 0,
  amazonPrecoListagemCentavos: 7700,
  amazonPrecoListagemSyncEm: null,
  amazonCategoriaFee: null,
  custoUnitario: 4758,
};

function chamar() {
  return GET(new Request("http://localhost/api/produtos/p1/resumo-mobile"), {
    params: Promise.resolve({ id: "p1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  capturas.empresaNoImposto = undefined;
  sessao.atual = { ...sessao.atual, role: "OPERADOR", empresaId: "udn" };
  dbMock.produto.findFirst.mockResolvedValue(produtoBase);
  dbMock.vendaAmazon.aggregate.mockResolvedValue({ _sum: { quantidade: 0 } });
  dbMock.produtoCustoHistorico.findFirst.mockResolvedValue(null);
  dbMock.produtoCustoHistorico.findMany.mockResolvedValue([]);
});

describe("GET /api/produtos/[id]/resumo-mobile", () => {
  it("lê a config do Simples dentro do contexto da empresa da sessão (não da primária)", async () => {
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(capturas.empresaNoImposto).toBe("udn");
  });

  it("custo e 'vigente desde' vêm da MESMA vigência que cobre hoje (filtro de vigenciaFim)", async () => {
    dbMock.produtoCustoHistorico.findMany.mockResolvedValue([
      {
        custoCentavos: 5100,
        vigenciaInicio: new Date("2026-09-01T00:00:00.000Z"),
        vigenciaFim: null,
      },
    ]);
    const res = await chamar();
    const corpo = (await res.json()) as { custo: unknown };
    expect(corpo.custo).toEqual({
      centavos: 5100,
      vigenteDesde: "2026-09-01T00:00:00.000Z",
      todoHistorico: false,
    });
    const args = dbMock.produtoCustoHistorico.findMany.mock.calls[0]?.[0] as {
      where: { OR?: unknown };
    };
    expect(args.where.OR).toEqual([
      { vigenciaFim: null },
      { vigenciaFim: { gt: expect.any(Date) } },
    ]);
  });

  it("sem vigência cobrindo hoje: custo do cadastro e sem data de vigência", async () => {
    const res = await chamar();
    const corpo = (await res.json()) as { custo: unknown };
    expect(corpo.custo).toEqual({ centavos: 4758, vigenteDesde: null, todoHistorico: false });
  });

  it("papel LEITURA não lê custo e margem (mesma regra das demais rotas de produto)", async () => {
    sessao.atual = { ...sessao.atual, role: "LEITURA" };
    const res = await chamar();
    expect(res.status).toBe(403);
  });
});
