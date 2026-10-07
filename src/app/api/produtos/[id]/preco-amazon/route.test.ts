import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEmpresaId } from "@/lib/tenant-context";
import { AmazonQuotaCooldownError } from "@/lib/amazon-rate-limit";

const sessao = vi.hoisted(() => ({
  atual: {
    uid: "u-adm",
    email: "adm@udn.test",
    nome: "Admin UDN",
    role: "ADMIN",
    exp: Math.floor(Date.now() / 1000) + 3600,
    empresaId: "udn",
  } as Record<string, unknown>,
}));

const capt = vi.hoisted(() => ({ empresaNasCreds: undefined as string | null | undefined }));

const dbMock = vi.hoisted(() => ({
  produto: { findFirst: vi.fn(), update: vi.fn() },
  amazonApiQuota: { findFirst: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const auditMock = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => auditMock);

vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  const exigir = async (...roles: string[]) => {
    const s = sessao.atual;
    if (roles.length > 0 && s.role !== "ADMIN" && !roles.includes(String(s.role))) {
      throw new Response(JSON.stringify({ erro: "NAO_AUTORIZADO" }), { status: 403 });
    }
    return s;
  };
  return {
    ...real,
    requireSession: vi.fn(() => exigir()),
    requireRole: vi.fn((...roles: string[]) => exigir(...roles)),
  };
});

const spMock = vi.hoisted(() => ({ getListingsItem: vi.fn(), spApiRequest: vi.fn() }));
vi.mock("@/lib/amazon-sp-api", () => spMock);

const svc = vi.hoisted(() => {
  class AmazonContaNaoConectadaError extends Error {
    constructor(public empresaId: string) {
      super(`[amazon] empresa ${empresaId} sem conta Amazon conectada`);
      this.name = "AmazonContaNaoConectadaError";
    }
  }
  return {
    AmazonContaNaoConectadaError,
    getCredentialsOrThrow: vi.fn(),
    resolverSellerIdDoTenant: vi.fn(),
  };
});
vi.mock("@/modules/amazon/service", () => svc);

import { POST } from "./route";

function chamar(body: unknown, id = "p1") {
  return POST(
    new Request(`http://localhost/api/produtos/${id}/preco-amazon`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as never,
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessao.atual.role = "ADMIN";
  dbMock.produto.findFirst.mockResolvedValue({ id: "p1", sku: "MFS-0036", amazonPrecoListagemCentavos: 7700 });
  dbMock.produto.update.mockResolvedValue({});
  dbMock.amazonApiQuota.findFirst.mockResolvedValue(null);
  svc.getCredentialsOrThrow.mockImplementation(async () => {
    capt.empresaNasCreds = getEmpresaId();
    return { marketplaceId: "A2Q3Y263D00KWC" };
  });
  svc.resolverSellerIdDoTenant.mockResolvedValue("SELLER1");
  spMock.getListingsItem.mockResolvedValue({
    summaries: [{ marketplaceId: "A2Q3Y263D00KWC", productType: "FOOD_STORAGE_CONTAINER" }],
  });
  spMock.spApiRequest.mockResolvedValue({ status: "ACCEPTED", submissionId: "s1" });
});

describe("POST /api/produtos/[id]/preco-amazon", () => {
  it("dedo gordo sem confirmação → 409 CONFIRMAR_VARIACAO e NÃO chama a Amazon", async () => {
    const r = await chamar({ precoCentavos: 770 });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.erro).toBe("CONFIRMAR_VARIACAO");
    expect(j.detalhes).toEqual({ atualCentavos: 7700, novoCentavos: 770 });
    expect(spMock.spApiRequest).not.toHaveBeenCalled();
    expect(spMock.getListingsItem).not.toHaveBeenCalled();
    expect(dbMock.produto.update).not.toHaveBeenCalled();
  });

  it("com confirmação → 200, PATCH real, cache atualizado e auditoria", async () => {
    const r = await chamar({ precoCentavos: 770, confirmarVariacao: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, status: "ACCEPTED" });
    const [, path, opts] = spMock.spApiRequest.mock.calls[0] ?? [];
    expect(path).toBe("/listings/2021-08-01/items/SELLER1/MFS-0036");
    expect(opts.method).toBe("PATCH");
    expect(opts.params.mode).toBeUndefined();
    expect(opts.body.patches[0].value[0].our_price[0].schedule[0].value_with_tax).toBe(7.7);
    expect(dbMock.produto.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: expect.objectContaining({ amazonPrecoListagemCentavos: 770, amazonPrecoListagemSyncEm: expect.any(Date) }),
    });
    expect(auditMock.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "PRECO_AMAZON_ALTERADO",
        entidade: "Produto",
        entidadeId: "p1",
        antes: { precoCentavos: 7700 },
        depois: { precoCentavos: 770 },
      }),
    );
    // credencial do tenant da SESSÃO
    expect(capt.empresaNasCreds).toBe("udn");
  });

  it("variação pequena sem confirmação passa direto", async () => {
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(200);
  });

  it("403 no PATCH → 403 com mensagem clara e cache NÃO atualizado", async () => {
    spMock.spApiRequest.mockRejectedValue(new Error("SP-API PATCH /listings/2021-08-01/items/SELLER1/MFS-0036 -> 403: {}"));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(403);
    const j = await r.json();
    expect(j.erro).toMatch(/Product Listing/);
    expect(j.erro).toMatch(/Configurações → Integrações/);
    expect(dbMock.produto.update).not.toHaveBeenCalled();
    expect(auditMock.auditLog).not.toHaveBeenCalled();
  });

  it("403 já na leitura do anúncio → 403 também", async () => {
    spMock.getListingsItem.mockRejectedValue(new Error("SP-API GET /listings/2021-08-01/items/SELLER1/MFS-0036 -> 403: {}"));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(403);
    expect(dbMock.produto.update).not.toHaveBeenCalled();
  });

  it("INVALID → 422 com a mensagem da Amazon", async () => {
    spMock.spApiRequest.mockResolvedValue({ status: "INVALID", issues: [{ severity: "ERROR", message: "Preço abaixo do mínimo." }] });
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(422);
    expect((await r.json()).erro).toBe("Preço abaixo do mínimo.");
    expect(dbMock.produto.update).not.toHaveBeenCalled();
  });

  it("cooldown (fail-fast do reserve) → 429 sem chamar fetch", async () => {
    spMock.spApiRequest.mockRejectedValue(new AmazonQuotaCooldownError("LISTINGS_PATCH_ITEM" as never, new Date(Date.now() + 60_000)));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(429);
  });

  it("429 da Amazon (mensagem 'SP-API quota') → 429", async () => {
    spMock.spApiRequest.mockRejectedValue(new Error("SP-API quota LISTINGS_PATCH_ITEM ate 2026-10-07T00:00:00.000Z: {}"));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(429);
  });

  it("erro genérico → 502", async () => {
    spMock.spApiRequest.mockRejectedValue(new Error("SP-API PATCH /x -> 500: {}"));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(502);
  });

  it("empresa sem loja conectada → 422", async () => {
    svc.getCredentialsOrThrow.mockRejectedValue(new svc.AmazonContaNaoConectadaError("udn"));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(422);
    expect((await r.json()).erro).toMatch(/Loja Amazon não conectada/);
  });

  it("OPERADOR → 403 e nem lê o produto", async () => {
    sessao.atual.role = "OPERADOR";
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(403);
    expect(dbMock.produto.findFirst).not.toHaveBeenCalled();
  });

  it("produto de outra empresa (findFirst escopado devolve null) → 404", async () => {
    dbMock.produto.findFirst.mockResolvedValue(null);
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBe(404);
    expect(spMock.spApiRequest).not.toHaveBeenCalled();
  });

  it("Zod: < R$ 1,00 e não inteiro → 400", async () => {
    expect((await chamar({ precoCentavos: 50 })).status).toBe(400);
    expect((await chamar({ precoCentavos: 7700.5 })).status).toBe(400);
    expect((await chamar({ precoCentavos: "7700" })).status).toBe(400);
  });

  it("produto sem preço em cache (null) não pede confirmação", async () => {
    dbMock.produto.findFirst.mockResolvedValue({ id: "p1", sku: "MFS-0036", amazonPrecoListagemCentavos: null });
    const r = await chamar({ precoCentavos: 100 });
    expect(r.status).toBe(200);
  });

  it("falha do update do cache DEPOIS do PATCH aceito → resposta de erro e sem auditoria", async () => {
    dbMock.produto.update.mockRejectedValue(new Error("db caiu"));
    const r = await chamar({ precoCentavos: 7990 });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(spMock.spApiRequest).toHaveBeenCalled();
    expect(auditMock.auditLog).not.toHaveBeenCalled();
  });
});
