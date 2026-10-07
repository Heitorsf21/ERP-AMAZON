import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    pushDispositivo: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  apelidoDoUserAgent,
  atualizarPreferencia,
  inscreverDispositivo,
  inscricaoSchema,
  removerDispositivo,
} from "./dispositivos";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.pushDispositivo.upsert.mockResolvedValue({ id: "d1" });
  dbMock.pushDispositivo.deleteMany.mockResolvedValue({ count: 1 });
  dbMock.pushDispositivo.updateMany.mockResolvedValue({ count: 1 });
});

describe("mesmo celular em duas lojas", () => {
  it("cria uma inscrição por empresa para o mesmo endpoint", async () => {
    const base = { usuarioId: "u1", endpoint: "https://web.push.apple.com/abc", p256dh: "p", auth: "a", userAgent: IPHONE };
    await inscreverDispositivo({ ...base, empresaId: "mundofs" });
    await inscreverDispositivo({ ...base, usuarioId: "u9", empresaId: "udncd" });
    const chaves = dbMock.pushDispositivo.upsert.mock.calls.map((c) => c[0].where.empresaId_endpoint);
    expect(chaves).toEqual([
      { empresaId: "mundofs", endpoint: base.endpoint },
      { empresaId: "udncd", endpoint: base.endpoint },
    ]);
    expect(dbMock.pushDispositivo.upsert.mock.calls[0]?.[0].create.apelido).toBe("iPhone");
  });

  it("remover numa loja não toca a outra (filtro por empresa e usuário)", async () => {
    await removerDispositivo({ empresaId: "mundofs", usuarioId: "u1", endpoint: "https://web.push.apple.com/abc" });
    expect(dbMock.pushDispositivo.deleteMany).toHaveBeenCalledWith({
      where: { empresaId: "mundofs", usuarioId: "u1", endpoint: "https://web.push.apple.com/abc" },
    });
  });

  it("remover exige endpoint ou id", async () => {
    await expect(removerDispositivo({ empresaId: "mundofs", usuarioId: "u1" })).rejects.toThrow();
  });

  it("preferência só muda o aparelho do próprio usuário na própria loja", async () => {
    await atualizarPreferencia({ empresaId: "udncd", usuarioId: "u9", endpoint: "https://e", receberVendas: false });
    expect(dbMock.pushDispositivo.updateMany).toHaveBeenCalledWith({
      where: { empresaId: "udncd", usuarioId: "u9", endpoint: "https://e" },
      data: { receberVendas: false },
    });
  });
});

describe("validação e apelido", () => {
  it("endpoint precisa ser https", () => {
    expect(inscricaoSchema.safeParse({ endpoint: "http://x.com/1", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }).success).toBe(false);
    expect(inscricaoSchema.safeParse({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }).success).toBe(true);
  });

  it("apelido legível a partir do navegador", () => {
    expect(apelidoDoUserAgent(IPHONE)).toBe("iPhone");
    expect(apelidoDoUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/126 Mobile")).toBe("Android");
    expect(apelidoDoUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154")).toBe("Computador (Windows)");
    expect(apelidoDoUserAgent(null)).toBe("Navegador");
  });
});
