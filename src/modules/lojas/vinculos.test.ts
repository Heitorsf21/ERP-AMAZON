import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ usuario: { findUnique: vi.fn(), findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import type { Chaveiro } from "./chaveiro";
import { contaVinculadaNaEmpresa, ErroVinculo, listarLojas, prepararVinculo } from "./vinculos";

type Conta = {
  id: string;
  email: string;
  nome: string;
  role: string;
  ativo: boolean;
  sessionVersion: number;
  empresaId: string;
  empresa: { nome: string; ativa: boolean };
};

const conta = (id: string, empresaId: string, nomeLoja: string, over: Partial<Conta> = {}): Conta => ({
  id,
  email: `${id}@loja.test`,
  nome: `Pessoa ${id}`,
  role: "ADMIN",
  ativo: true,
  sessionVersion: 0,
  empresaId,
  empresa: { nome: nomeLoja, ativa: true },
  ...over,
});

const mfs = conta("u-mfs", "mundofs", "MundoFS");
const udn = conta("u-udn", "udn", "UDN");
const zeta = conta("u-zeta", "zeta", "Zeta");
const TODAS = [mfs, udn, zeta];

function chaveiro(...contas: { uid: string; v: number }[]): Chaveiro {
  return { contas, exp: Math.floor(Date.now() / 1000) + 3600 };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.usuario.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    TODAS.find((c) => c.id === where.id) ?? null,
  );
  dbMock.usuario.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    TODAS.filter((c) => where.id.in.includes(c.id)),
  );
});

describe("listarLojas (vínculo é do aparelho)", () => {
  it("aparelho sem chaveiro (ex.: o sócio no celular dele): só a loja do login", async () => {
    const r = await listarLojas("u-udn", null);
    expect(r?.atual).toMatchObject({ empresaId: "udn", nome: "UDN" });
    expect(r?.vinculadas).toEqual([]);
    expect(dbMock.usuario.findMany).not.toHaveBeenCalled();
  });

  it("chaveiro de outra pessoa no mesmo navegador não vale para quem não está nele", async () => {
    const r = await listarLojas("u-zeta", chaveiro({ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }));
    expect(r?.vinculadas).toEqual([]);
  });

  it("aparelho de quem vinculou: as outras lojas do chaveiro, por nome", async () => {
    const r = await listarLojas("u-udn", chaveiro({ uid: "u-zeta", v: 0 }, { uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }));
    expect(r?.vinculadas.map((l) => l.nome)).toEqual(["MundoFS", "Zeta"]);
    expect(r?.vinculadas[0]).toMatchObject({ vinculoId: "u-mfs", empresaId: "mundofs", email: "u-mfs@loja.test" });
  });

  it("conta que trocou a senha depois de vincular sai da lista", async () => {
    const r = await listarLojas(
      "u-mfs",
      chaveiro({ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }),
    );
    expect(r?.vinculadas).toHaveLength(1);
    dbMock.usuario.findMany.mockResolvedValueOnce([mfs, { ...udn, sessionVersion: 1 }]);
    const depois = await listarLojas("u-mfs", chaveiro({ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }));
    expect(depois?.vinculadas).toEqual([]);
  });

  it("se a própria conta trocou a senha, o chaveiro dela não vale mais", async () => {
    dbMock.usuario.findUnique.mockResolvedValueOnce({ ...mfs, sessionVersion: 2 });
    const r = await listarLojas("u-mfs", chaveiro({ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }));
    expect(r?.vinculadas).toEqual([]);
  });

  it("conta ou loja desativada sai da lista", async () => {
    dbMock.usuario.findMany.mockResolvedValueOnce([mfs, { ...udn, empresa: { nome: "UDN", ativa: false } }]);
    const r = await listarLojas("u-mfs", chaveiro({ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }));
    expect(r?.vinculadas).toEqual([]);
  });

  it("conta inexistente ou inativa → null", async () => {
    expect(await listarLojas("u-x", null)).toBeNull();
    dbMock.usuario.findUnique.mockResolvedValueOnce({ ...mfs, ativo: false });
    expect(await listarLojas("u-mfs", null)).toBeNull();
  });
});

describe("contaVinculadaNaEmpresa", () => {
  const ch = chaveiro({ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 });

  it("devolve a conta da outra loja quando ela está no chaveiro deste aparelho", async () => {
    expect((await contaVinculadaNaEmpresa("u-mfs", "udn", ch))?.id).toBe("u-udn");
    expect((await contaVinculadaNaEmpresa("u-udn", "mundofs", ch))?.id).toBe("u-mfs");
  });

  it("sem chaveiro, loja fora dele ou a própria loja → null", async () => {
    expect(await contaVinculadaNaEmpresa("u-udn", "mundofs", null)).toBeNull();
    expect(await contaVinculadaNaEmpresa("u-mfs", "zeta", ch)).toBeNull();
    expect(await contaVinculadaNaEmpresa("u-mfs", "mundofs", ch)).toBeNull();
  });
});

describe("prepararVinculo", () => {
  it("as duas contas com a versão atual vão para o chaveiro", async () => {
    dbMock.usuario.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "u-udn" ? { ...udn, sessionVersion: 3 } : mfs,
    );
    const r = await prepararVinculo("u-mfs", "u-udn");
    expect(r.contas).toEqual([{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 3 }]);
    expect(r.loja).toMatchObject({ vinculoId: "u-udn", empresaId: "udn", nome: "UDN" });
  });

  it("recusa conta da mesma loja ou a própria conta", async () => {
    const mfs2 = conta("u-mfs2", "mundofs", "MundoFS");
    dbMock.usuario.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "u-mfs2" ? mfs2 : mfs,
    );
    await expect(prepararVinculo("u-mfs", "u-mfs2")).rejects.toEqual(new ErroVinculo("MESMA_LOJA"));
    await expect(prepararVinculo("u-mfs", "u-mfs")).rejects.toEqual(new ErroVinculo("MESMA_LOJA"));
  });
});
