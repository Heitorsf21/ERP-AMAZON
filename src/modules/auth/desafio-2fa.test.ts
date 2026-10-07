import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const dbMock = vi.hoisted(() => ({
  codigoVerificacao2FA: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const emailMock = vi.hoisted(() => ({ enviarEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", () => ({ ...emailMock, escapeHtml: (s: string) => s }));

const auditMock = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => auditMock);

vi.mock("@/lib/totp", () => ({ verificarTotp: vi.fn((codigo: string) => codigo === "111111") }));
vi.mock("@/lib/crypto", () => ({ decryptConfigValue: vi.fn(() => "segredo") }));

import { conferirDesafio2FA, criarDesafio2FA } from "./desafio-2fa";

const usuario = {
  id: "u-udn",
  email: "loja@udn.test",
  nome: "UDN",
  twoFactorEnabled: true,
  twoFactorMethod: "EMAIL" as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criarDesafio2FA", () => {
  it("conta sem 2FA não gera desafio", async () => {
    expect(await criarDesafio2FA({ ...usuario, twoFactorEnabled: false }, "LOGIN")).toBeNull();
    expect(await criarDesafio2FA({ ...usuario, twoFactorMethod: null }, "LOGIN")).toBeNull();
    expect(dbMock.codigoVerificacao2FA.create).not.toHaveBeenCalled();
  });

  it("2FA por e-mail grava o desafio com a finalidade e manda o código", async () => {
    const r = await criarDesafio2FA(usuario, "VINCULO:u-mfs");
    expect(r?.metodo).toBe("EMAIL");
    expect(r?.challengeId).toMatch(/^[0-9a-f]{32}$/);
    const data = dbMock.codigoVerificacao2FA.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({ usuarioId: "u-udn", finalidade: "VINCULO:u-mfs", challengeId: r?.challengeId });
    expect(emailMock.enviarEmail).toHaveBeenCalledTimes(1);
  });

  it("2FA por app autenticador grava o desafio sem mandar e-mail", async () => {
    const r = await criarDesafio2FA({ ...usuario, twoFactorMethod: "TOTP" }, "LOGIN");
    expect(r?.metodo).toBe("TOTP");
    expect(dbMock.codigoVerificacao2FA.create.mock.calls[0]?.[0]?.data).toMatchObject({
      metodo: "TOTP",
      finalidade: "LOGIN",
    });
    expect(emailMock.enviarEmail).not.toHaveBeenCalled();
  });
});

describe("conferirDesafio2FA", () => {
  const req = new Request("http://localhost/api/x", { method: "POST" });

  async function desafio(over: Record<string, unknown> = {}) {
    return {
      id: "c1",
      usuarioId: "u-udn",
      codigoHash: await bcrypt.hash("123456", 4),
      metodo: "EMAIL",
      finalidade: "VINCULO:u-mfs",
      challengeId: "abc",
      expiresAt: new Date(Date.now() + 60_000),
      usadoEm: null,
      tentativas: 0,
      usuario: { id: "u-udn", ativo: true, totpSecretEnc: null },
      ...over,
    };
  }

  it("finalidade diferente é recusada sem gastar tentativa", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio());
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "123456", finalidade: "LOGIN", req });
    expect(r).toEqual({ ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
    expect(dbMock.codigoVerificacao2FA.update).not.toHaveBeenCalled();
    expect(dbMock.codigoVerificacao2FA.updateMany).not.toHaveBeenCalled();
  });

  it("desafio expirado ou já usado é recusado", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(
      await desafio({ expiresAt: new Date(Date.now() - 1) }),
    );
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "123456", finalidade: "VINCULO:u-mfs", req });
    expect(r).toEqual({ ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
  });

  it("código errado soma uma tentativa", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio({ tentativas: 1 }));
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "000000", finalidade: "VINCULO:u-mfs", req });
    expect(r).toEqual({ ok: false, erro: "CODIGO_INCORRETO" });
    expect(dbMock.codigoVerificacao2FA.update.mock.calls[0]?.[0]?.data).toMatchObject({ tentativas: 2 });
  });

  it("a 5ª tentativa errada bloqueia o desafio", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio({ tentativas: 4 }));
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "000000", finalidade: "VINCULO:u-mfs", req });
    expect(r).toEqual({ ok: false, erro: "CHALLENGE_BLOQUEADO" });
    expect(dbMock.codigoVerificacao2FA.update.mock.calls[0]?.[0]?.data.usadoEm).toBeInstanceOf(Date);
  });

  it("código certo marca o desafio como usado e devolve a conta", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio());
    dbMock.codigoVerificacao2FA.updateMany.mockResolvedValue({ count: 1 });
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "123456", finalidade: "VINCULO:u-mfs", req });
    expect(r.ok).toBe(true);
    expect(r.ok && r.usuario.id).toBe("u-udn");
    expect(dbMock.codigoVerificacao2FA.updateMany.mock.calls[0]?.[0]?.where).toMatchObject({ id: "c1", usadoEm: null });
  });

  it("dois envios do código certo ao mesmo tempo: só o primeiro vale", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio());
    dbMock.codigoVerificacao2FA.updateMany.mockResolvedValue({ count: 0 });
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "123456", finalidade: "VINCULO:u-mfs", req });
    expect(r).toEqual({ ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
  });

  it("TOTP confere contra o segredo do app", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(
      await desafio({ metodo: "TOTP", codigoHash: "-", usuario: { id: "u-udn", ativo: true, totpSecretEnc: "x" } }),
    );
    dbMock.codigoVerificacao2FA.updateMany.mockResolvedValue({ count: 1 });
    const r = await conferirDesafio2FA({ challengeId: "abc", codigo: "111111", finalidade: "VINCULO:u-mfs", req });
    expect(r.ok).toBe(true);
  });
});
