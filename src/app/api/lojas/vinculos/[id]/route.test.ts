import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ uid: "u-mfs", email: "mfs@loja.test", nome: "H", role: "LEITURA", exp: 0, empresaId: "mundofs" })),
}));

const vinculos = vi.hoisted(() => ({ removerVinculo: vi.fn() }));
vi.mock("@/modules/lojas/vinculos", () => vinculos);

const audit = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => audit);

import { DELETE } from "./route";

function chamar(id: string) {
  return DELETE(new Request(`http://localhost/api/lojas/vinculos/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/lojas/vinculos/[id]", () => {
  it("desfaz o vínculo da própria conta (qualquer papel) e audita", async () => {
    vinculos.removerVinculo.mockResolvedValueOnce(true);
    const res = await chamar("v1");
    expect(res.status).toBe(200);
    expect(vinculos.removerVinculo).toHaveBeenCalledWith("u-mfs", "v1");
    expect(audit.auditLog).toHaveBeenCalledWith(expect.objectContaining({ acao: "LOJA_DESVINCULADA", entidadeId: "v1" }));
  });

  it("vínculo de outra conta ou inexistente: 404", async () => {
    vinculos.removerVinculo.mockResolvedValueOnce(false);
    const res = await chamar("v-alheio");
    expect(res.status).toBe(404);
    expect(audit.auditLog).not.toHaveBeenCalled();
  });
});
