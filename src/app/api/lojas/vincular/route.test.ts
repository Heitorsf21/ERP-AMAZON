import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const sessao = vi.hoisted(() => ({
  atual: { uid: "u-mfs", email: "mfs@loja.test", nome: "Heitor", role: "ADMIN", exp: 0, empresaId: "mundofs" },
}));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => sessao.atual) }));

const dbMock = vi.hoisted(() => ({ usuario: { findUnique: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const limite = vi.hoisted(() => ({
  recordLoginFailureByKey: vi.fn(async () => ({ limited: false, retryAfterSeconds: 0 })),
  resetLoginFailuresByKey: vi.fn(async () => undefined),
  getLoginFailureKey: vi.fn((_h: Headers, email: string) => `ip:${email}`),
}));
vi.mock("@/lib/auth-rate-limit", () => limite);

const desafio = vi.hoisted(() => ({
  criarDesafio2FA: vi.fn(async () => null as null | { challengeId: string; metodo: string }),
  conferirDesafio2FA: vi.fn(),
  finalidadeVinculo: (uid: string) => `VINCULO:${uid}`,
}));
vi.mock("@/modules/auth/desafio-2fa", () => desafio);

const vinculos = vi.hoisted(() => ({
  criarVinculo: vi.fn(async () => ({
    empresaId: "udn",
    nome: "UDN",
    email: "udn@loja.test",
    papel: "ADMIN",
    vinculoId: "v1",
    vinculadaEm: "2026-10-07T12:00:00.000Z",
  })),
  ErroVinculo: class ErroVinculo extends Error {
    constructor(public codigo: string) {
      super(codigo);
    }
  },
}));
vi.mock("@/modules/lojas/vinculos", () => vinculos);

const audit = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => audit);

import { POST } from "./route";
import { POST as POST_2FA } from "./2fa/route";

let hashSenha = "";

function chamar(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/lojas/vincular", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const contaUdn = () => ({
  id: "u-udn",
  email: "udn@loja.test",
  nome: "UDN",
  senhaHash: hashSenha,
  ativo: true,
  twoFactorEnabled: false,
  twoFactorMethod: null,
  empresa: { ativa: true },
});

beforeEach(async () => {
  vi.clearAllMocks();
  hashSenha ||= await bcrypt.hash("senha-certa", 4);
  dbMock.usuario.findUnique.mockResolvedValue(contaUdn());
});

describe("POST /api/lojas/vincular", () => {
  it("senha errada: 401 e falha contada no limite de tentativas", async () => {
    const res = await chamar({ email: "UDN@loja.test ", senha: "errada" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "CREDENCIAIS_INVALIDAS" });
    expect(limite.recordLoginFailureByKey).toHaveBeenCalledWith("vinculo:ip:udn@loja.test");
    expect(vinculos.criarVinculo).not.toHaveBeenCalled();
  });

  it("e-mail inexistente: mesmo 401", async () => {
    dbMock.usuario.findUnique.mockResolvedValue(null);
    const res = await chamar({ email: "ninguem@loja.test", senha: "x" });
    expect(res.status).toBe(401);
  });

  it("estourou o limite: 429 com Retry-After", async () => {
    limite.recordLoginFailureByKey.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 60 });
    const res = await chamar({ email: "udn@loja.test", senha: "errada" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("conta sem 2FA: cria o vínculo e audita", async () => {
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect(res.status).toBe(200);
    expect((await res.json()).loja).toMatchObject({ empresaId: "udn", vinculoId: "v1" });
    expect(vinculos.criarVinculo).toHaveBeenCalledWith("u-mfs", "u-udn");
    expect(limite.resetLoginFailuresByKey).toHaveBeenCalledWith("vinculo:ip:udn@loja.test");
    expect(audit.auditLog).toHaveBeenCalledWith(expect.objectContaining({ acao: "LOJA_VINCULADA" }));
  });

  it("conta com 2FA: pede o código, com o desafio amarrado a esta sessão", async () => {
    dbMock.usuario.findUnique.mockResolvedValue({ ...contaUdn(), twoFactorEnabled: true, twoFactorMethod: "EMAIL" });
    desafio.criarDesafio2FA.mockResolvedValueOnce({ challengeId: "c".repeat(32), metodo: "EMAIL" });
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect(await res.json()).toEqual({ requires2FA: true, challengeId: "c".repeat(32), metodo: "EMAIL" });
    expect(desafio.criarDesafio2FA).toHaveBeenCalledWith(expect.objectContaining({ id: "u-udn" }), "VINCULO:u-mfs");
    expect(vinculos.criarVinculo).not.toHaveBeenCalled();
  });

  it("mesma loja: 400 MESMA_LOJA", async () => {
    vinculos.criarVinculo.mockRejectedValueOnce(new vinculos.ErroVinculo("MESMA_LOJA"));
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: "MESMA_LOJA" });
  });

  it("origem de outro site é bloqueada", async () => {
    const antes = { enforce: process.env.CSRF_ENFORCE_ORIGIN, app: process.env.APP_URL };
    process.env.CSRF_ENFORCE_ORIGIN = "true";
    process.env.APP_URL = "https://erp.mundofs.cloud";
    try {
      const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" }, { origin: "https://malicioso.example" });
      expect(res.status).toBe(403);
      expect(vinculos.criarVinculo).not.toHaveBeenCalled();
    } finally {
      process.env.CSRF_ENFORCE_ORIGIN = antes.enforce;
      process.env.APP_URL = antes.app;
    }
  });
});

describe("POST /api/lojas/vincular/2fa", () => {
  function chamar2fa() {
    return POST_2FA(
      new Request("http://localhost/api/lojas/vincular/2fa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: "c".repeat(32), codigo: "123456" }),
      }),
    );
  }

  it("confere o desafio desta sessão e cria o vínculo", async () => {
    desafio.conferirDesafio2FA.mockResolvedValueOnce({ ok: true, usuario: { id: "u-udn" } });
    const res = await chamar2fa();
    expect(res.status).toBe(200);
    expect(desafio.conferirDesafio2FA).toHaveBeenCalledWith(
      expect.objectContaining({ finalidade: "VINCULO:u-mfs" }),
    );
    expect(vinculos.criarVinculo).toHaveBeenCalledWith("u-mfs", "u-udn");
  });

  it("código errado ou desafio de outra sessão: 401", async () => {
    desafio.conferirDesafio2FA.mockResolvedValueOnce({ ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
    const res = await chamar2fa();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
    expect(vinculos.criarVinculo).not.toHaveBeenCalled();
  });
});
