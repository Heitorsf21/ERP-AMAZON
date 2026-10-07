import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    configuracaoSistema: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { lerOcultas, salvarOcultas } from "./service";

describe("preferência de menu no banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.configuracaoSistema.upsert.mockResolvedValue({});
  });

  it("sem linha salva, nada fica oculto", async () => {
    dbMock.configuracaoSistema.findUnique.mockResolvedValue(null);
    expect(await lerOcultas("u1")).toEqual([]);
    expect(dbMock.configuracaoSistema.findUnique).toHaveBeenCalledWith({
      where: { chave: "menu_abas_ocultas:u:u1" },
    });
  });

  it("ao ler, descarta hrefs que saíram do menu e abas fixas", async () => {
    dbMock.configuracaoSistema.findUnique.mockResolvedValue({
      valor: JSON.stringify(["/caixa", "/aba-removida", "/vendas"]),
    });
    expect(await lerOcultas("u1")).toEqual(["/caixa"]);
  });

  it("ao salvar, grava só o que é válido e devolve a lista limpa", async () => {
    const r = await salvarOcultas("u2", ["/vendas", "/dre", "/agenda", "/dre", "/x"]);
    expect(r).toEqual(["/agenda", "/dre"]);
    expect(dbMock.configuracaoSistema.upsert).toHaveBeenCalledWith({
      where: { chave: "menu_abas_ocultas:u:u2" },
      create: { chave: "menu_abas_ocultas:u:u2", valor: '["/agenda","/dre"]' },
      update: { valor: '["/agenda","/dre"]' },
    });
  });
});
