import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getEmpresaId } from "@/lib/tenant-context";

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

const capturas = vi.hoisted(() => ({ empresaNoBreakdown: undefined as string | null | undefined }));

const dbMock = vi.hoisted(() => ({
  vendaAmazon: { count: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    requireRole: vi.fn(async () => sessao.atual),
    requireSession: vi.fn(async () => sessao.atual),
  };
});

vi.mock("@/modules/vendas/breakdown", () => ({
  montarBreakdownVendas: vi.fn(async () => {
    capturas.empresaNoBreakdown = getEmpresaId();
    return { breakdownPorVenda: new Map(), produtoPorSku: new Map() };
  }),
}));

vi.mock("@/modules/produtos/fee-estimator", () => ({
  loadFeeEstimatorConfig: vi.fn(async () => ({ referralDefaultBps: 1200 })),
}));

import { GET } from "./route";

function chamar(query: string) {
  return GET(new NextRequest(`http://localhost/api/vendas?${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  capturas.empresaNoBreakdown = undefined;
  dbMock.vendaAmazon.count.mockResolvedValue(0);
  dbMock.vendaAmazon.findMany.mockResolvedValue([]);
});

describe("GET /api/vendas", () => {
  it("monta o breakdown (imposto por empresa) no contexto da empresa da sessão", async () => {
    const res = await chamar("preset=30d&visao=principal");
    expect(res.status).toBe(200);
    expect(capturas.empresaNoBreakdown).toBe("udn");
  });

  it("?pedido= procura em todas as visões (cancelado/reembolsado depois do aviso ainda abre)", async () => {
    await chamar("preset=vitalicio&visao=principal&pedido=702-4417820-3391045");
    const where = JSON.stringify(dbMock.vendaAmazon.findMany.mock.calls[0]?.[0]?.where);
    expect(where).toContain("702-4417820-3391045");
    expect(where).not.toContain("Canceled");
  });

  it("?loja= de outra empresa: responde 'outra loja' sem consultar vendas", async () => {
    const res = await chamar("visao=principal&pedido=702-4417820-3391045&loja=mundofs");
    const corpo = (await res.json()) as { pedidoDeOutraLoja?: boolean; total: number };
    expect(corpo.pedidoDeOutraLoja).toBe(true);
    expect(corpo.total).toBe(0);
    expect(dbMock.vendaAmazon.findMany).not.toHaveBeenCalled();
  });

  it("?loja= da própria empresa: busca normalmente", async () => {
    const res = await chamar("visao=principal&pedido=702-4417820-3391045&loja=udn");
    const corpo = (await res.json()) as { pedidoDeOutraLoja?: boolean };
    expect(corpo.pedidoDeOutraLoja).toBe(false);
    expect(dbMock.vendaAmazon.findMany).toHaveBeenCalled();
  });
});
