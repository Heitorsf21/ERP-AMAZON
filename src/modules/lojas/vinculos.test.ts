import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  usuario: { findUnique: vi.fn() },
  vinculoLoja: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import {
  contaVinculadaNaEmpresa,
  criarVinculo,
  ErroVinculo,
  listarLojas,
  removerVinculo,
} from "./vinculos";

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

const vinculo = (a: Conta, b: Conta, over: Record<string, unknown> = {}) => ({
  id: `v-${a.id}-${b.id}`,
  usuarioAId: a.id,
  usuarioBId: b.id,
  versaoA: a.sessionVersion,
  versaoB: b.sessionVersion,
  criadoPorId: a.id,
  criadoEm: new Date("2026-10-07T12:00:00Z"),
  usuarioA: a,
  usuarioB: b,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listarLojas", () => {
  it("a loja aberta e as vinculadas válidas, pelo lado oposto, ordenadas por nome", async () => {
    dbMock.usuario.findUnique.mockResolvedValue(mfs);
    dbMock.vinculoLoja.findMany.mockResolvedValue([vinculo(mfs, zeta), vinculo(mfs, udn)]);
    const r = await listarLojas("u-mfs");
    expect(r?.atual).toEqual({ empresaId: "mundofs", nome: "MundoFS", email: "u-mfs@loja.test", papel: "ADMIN" });
    expect(r?.vinculadas.map((l) => l.nome)).toEqual(["UDN", "Zeta"]);
    expect(r?.vinculadas[0]).toMatchObject({ vinculoId: "v-u-mfs-u-udn", empresaId: "udn", email: "u-udn@loja.test" });
  });

  it("ignora o vínculo de quem trocou a senha depois de vincular", async () => {
    dbMock.usuario.findUnique.mockResolvedValue(mfs);
    dbMock.vinculoLoja.findMany.mockResolvedValue([vinculo(mfs, udn, { versaoB: 0, usuarioB: { ...udn, sessionVersion: 1 } })]);
    const r = await listarLojas("u-mfs");
    expect(r?.vinculadas).toEqual([]);
  });

  it("duas contas da mesma loja vinculada aparecem uma vez só", async () => {
    const udn2 = conta("u-udn2", "udn", "UDN");
    dbMock.usuario.findUnique.mockResolvedValue(mfs);
    dbMock.vinculoLoja.findMany.mockResolvedValue([vinculo(mfs, udn), vinculo(mfs, udn2)]);
    const r = await listarLojas("u-mfs");
    expect(r?.vinculadas).toHaveLength(1);
  });

  it("conta inexistente ou inativa → null", async () => {
    dbMock.usuario.findUnique.mockResolvedValue(null);
    expect(await listarLojas("u-x")).toBeNull();
    dbMock.usuario.findUnique.mockResolvedValue({ ...mfs, ativo: false });
    expect(await listarLojas("u-mfs")).toBeNull();
  });
});

describe("criarVinculo", () => {
  it("grava o par em ordem com as versões atuais das duas contas", async () => {
    const udnV = { ...udn, sessionVersion: 3 };
    dbMock.usuario.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "u-udn" ? udnV : mfs,
    );
    dbMock.vinculoLoja.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
      id: "v1",
      criadoEm: new Date("2026-10-07T12:00:00Z"),
      ...create,
    }));
    const r = await criarVinculo("u-udn", "u-mfs");
    const arg = dbMock.vinculoLoja.upsert.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ usuarioAId_usuarioBId: { usuarioAId: "u-mfs", usuarioBId: "u-udn" } });
    expect(arg.create).toMatchObject({ usuarioAId: "u-mfs", usuarioBId: "u-udn", versaoA: 0, versaoB: 3, criadoPorId: "u-udn" });
    expect(arg.update).toMatchObject({ versaoA: 0, versaoB: 3 });
    expect(r).toMatchObject({ vinculoId: "v1", empresaId: "mundofs", nome: "MundoFS" });
  });

  it("recusa vincular duas contas da mesma loja", async () => {
    const mfs2 = conta("u-mfs2", "mundofs", "MundoFS");
    dbMock.usuario.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "u-mfs2" ? mfs2 : mfs,
    );
    await expect(criarVinculo("u-mfs", "u-mfs2")).rejects.toEqual(new ErroVinculo("MESMA_LOJA"));
    await expect(criarVinculo("u-mfs", "u-mfs")).rejects.toEqual(new ErroVinculo("MESMA_LOJA"));
    expect(dbMock.vinculoLoja.upsert).not.toHaveBeenCalled();
  });
});

describe("removerVinculo", () => {
  it("só remove vínculo do qual a conta faz parte", async () => {
    dbMock.vinculoLoja.deleteMany.mockResolvedValue({ count: 0 });
    expect(await removerVinculo("u-zeta", "v1")).toBe(false);
    expect(dbMock.vinculoLoja.deleteMany.mock.calls[0]?.[0]?.where).toEqual({
      id: "v1",
      OR: [{ usuarioAId: "u-zeta" }, { usuarioBId: "u-zeta" }],
    });
    dbMock.vinculoLoja.deleteMany.mockResolvedValue({ count: 1 });
    expect(await removerVinculo("u-mfs", "v1")).toBe(true);
  });
});

describe("contaVinculadaNaEmpresa", () => {
  it("devolve a conta da outra loja quando o vínculo vale", async () => {
    dbMock.usuario.findUnique.mockResolvedValue(mfs);
    dbMock.vinculoLoja.findMany.mockResolvedValue([vinculo(mfs, udn)]);
    expect((await contaVinculadaNaEmpresa("u-mfs", "udn"))?.id).toBe("u-udn");
  });

  it("sem vínculo válido para a empresa → null", async () => {
    dbMock.usuario.findUnique.mockResolvedValue(mfs);
    dbMock.vinculoLoja.findMany.mockResolvedValue([vinculo(mfs, udn)]);
    expect(await contaVinculadaNaEmpresa("u-mfs", "zeta")).toBeNull();
    expect(await contaVinculadaNaEmpresa("u-mfs", "mundofs")).toBeNull();
  });
});
