import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    empresa: { findFirst: vi.fn() },
    usuario: { findFirst: vi.fn() },
    conviteUsuario: { updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));

import { ativarPorCustomer } from "./ativacao";

describe("ativarPorCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.conviteUsuario.updateMany.mockReturnValue({});
    dbMock.conviteUsuario.create.mockReturnValue({});
  });

  it("retorna processando quando a empresa ainda não existe", async () => {
    dbMock.empresa.findFirst.mockResolvedValue(null);
    const r = await ativarPorCustomer("cus_1");
    expect(r).toEqual({ status: "processando" });
  });

  it("retorna processando quando o admin ainda não existe", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "e1", nome: "Loja" });
    dbMock.usuario.findFirst.mockResolvedValue(null);
    const r = await ativarPorCustomer("cus_1");
    expect(r).toEqual({ status: "processando" });
  });

  it("emite convite quando o admin nunca definiu senha (sessionVersion 0)", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "e1", nome: "Loja" });
    dbMock.usuario.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      sessionVersion: 0,
    });

    const r = await ativarPorCustomer("cus_1");

    expect(r.status).toBe("convite");
    if (r.status === "convite") {
      expect(r.email).toBe("a@b.com");
      expect(r.empresaNome).toBe("Loja");
      expect(r.token.length).toBeGreaterThan(20);
    }
    // invalida pendentes + cria novo, em transação
    expect(dbMock.conviteUsuario.updateMany).toHaveBeenCalledWith({
      where: { usuarioId: "u1", usadoEm: null },
      data: { usadoEm: expect.any(Date) },
    });
    expect(dbMock.conviteUsuario.create).toHaveBeenCalled();
    expect(dbMock.$transaction).toHaveBeenCalled();
  });

  it("retorna ja-ativo quando o admin já definiu senha (sessionVersion > 0)", async () => {
    dbMock.empresa.findFirst.mockResolvedValue({ id: "e1", nome: "Loja" });
    dbMock.usuario.findFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      sessionVersion: 2,
    });

    const r = await ativarPorCustomer("cus_1");

    expect(r).toEqual({ status: "ja-ativo" });
    expect(dbMock.conviteUsuario.create).not.toHaveBeenCalled();
  });
});
