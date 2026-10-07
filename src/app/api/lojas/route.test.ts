import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ uid: "u-mfs", email: "mfs@loja.test", nome: "H", role: "ADMIN", exp: 0, empresaId: "mundofs" })),
}));

const vinculos = vi.hoisted(() => ({ listarLojas: vi.fn() }));
vi.mock("@/modules/lojas/vinculos", () => vinculos);

import { GET } from "./route";

describe("GET /api/lojas", () => {
  it("lista as lojas da conta da sessão", async () => {
    const lojas = {
      atual: { empresaId: "mundofs", nome: "MundoFS", email: "mfs@loja.test", papel: "ADMIN" },
      vinculadas: [],
    };
    vinculos.listarLojas.mockResolvedValueOnce(lojas);
    const res = await GET();
    expect(vinculos.listarLojas).toHaveBeenCalledWith("u-mfs");
    expect(await res.json()).toEqual(lojas);
  });

  it("conta que sumiu entre o cookie e a consulta: 401", async () => {
    vinculos.listarLojas.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
