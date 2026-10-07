import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ uid: "u-mfs", email: "mfs@loja.test", nome: "H", role: "ADMIN", exp: 0, empresaId: "mundofs" })),
}));

const vinculos = vi.hoisted(() => ({ listarLojas: vi.fn() }));
vi.mock("@/modules/lojas/vinculos", () => vinculos);

const CHAVEIRO = vi.hoisted(() => ({ contas: [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }], exp: 4_000_000_000 }));
vi.mock("@/modules/lojas/chaveiro", () => ({ chaveiroDoRequest: vi.fn(async () => CHAVEIRO) }));

import { GET } from "./route";

describe("GET /api/lojas", () => {
  it("lista as lojas da conta da sessão NESTE aparelho (chaveiro do cookie)", async () => {
    const lojas = {
      atual: { empresaId: "mundofs", nome: "MundoFS", email: "mfs@loja.test", papel: "ADMIN" },
      vinculadas: [],
    };
    vinculos.listarLojas.mockResolvedValueOnce(lojas);
    const res = await GET();
    expect(vinculos.listarLojas).toHaveBeenCalledWith("u-mfs", CHAVEIRO);
    expect(await res.json()).toEqual(lojas);
  });

  it("conta que sumiu entre o cookie e a consulta: 401", async () => {
    vinculos.listarLojas.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
