import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  prepararVinculo: vi.fn(async (solicitanteId: string, alvoId: string) => ({
    contas: [
      { uid: solicitanteId, v: 0 },
      { uid: alvoId, v: 0 },
    ],
    loja: { empresaId: "udn", nome: "UDN", email: "udn@loja.test", papel: "ADMIN", vinculoId: alvoId },
  })),
  ErroVinculo: class ErroVinculo extends Error {
    constructor(public codigo: string) {
      super(codigo);
    }
  },
}));
vi.mock("@/modules/lojas/vinculos", () => vinculos);

// Chaveiro real (assinatura/merge); só a leitura do cookie do request é simulada.
const aparelho = vi.hoisted(() => ({ chaveiro: null as null | { contas: { uid: string; v: number }[]; exp: number } }));
vi.mock("@/modules/lojas/chaveiro", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/lojas/chaveiro")>();
  return { ...real, chaveiroDoRequest: vi.fn(async () => aparelho.chaveiro) };
});

const audit = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => audit);

import { lerChaveiro } from "@/modules/lojas/chaveiro";
import { POST } from "./route";
import { POST as POST_2FA } from "./2fa/route";

let hashSenha = "";

beforeAll(() => {
  process.env.SESSION_SECRET = "v".repeat(48);
});

function chamar(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/lojas/vincular", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function chaveiroDaResposta(res: Response) {
  const m = /erp_lojas=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  return lerChaveiro(m?.[1]);
}

const contaUdn = () => ({
  id: "u-udn",
  email: "udn@loja.test",
  nome: "UDN",
  senhaHash: hashSenha,
  empresaId: "udn",
  ativo: true,
  twoFactorEnabled: false,
  twoFactorMethod: null,
  empresa: { ativa: true },
});

beforeEach(async () => {
  vi.clearAllMocks();
  aparelho.chaveiro = null;
  hashSenha ||= await bcrypt.hash("senha-certa", 4);
  dbMock.usuario.findUnique.mockResolvedValue(contaUdn());
});

describe("POST /api/lojas/vincular", () => {
  it("senha errada: 401, falha contada e nenhum chaveiro", async () => {
    const res = await chamar({ email: "UDN@loja.test ", senha: "errada" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "CREDENCIAIS_INVALIDAS" });
    expect(limite.recordLoginFailureByKey).toHaveBeenCalledWith("vinculo:ip:udn@loja.test");
    expect(res.headers.get("set-cookie")).toBeNull();
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

  it("sem 2FA: grava o chaveiro SÓ neste aparelho, com as duas contas", async () => {
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect(res.status).toBe(200);
    expect((await res.json()).loja).toMatchObject({ empresaId: "udn", vinculoId: "u-udn" });
    expect((await chaveiroDaResposta(res))?.contas.map((c) => c.uid)).toEqual(["u-mfs", "u-udn"]);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(audit.auditLog).toHaveBeenCalledWith(expect.objectContaining({ acao: "LOJA_VINCULADA" }));
  });

  it("outra pessoa no aparelho do dono: o chaveiro novo não herda as lojas do dono", async () => {
    aparelho.chaveiro = { contas: [{ uid: "u-dono", v: 0 }, { uid: "u-outra", v: 0 }], exp: 4_000_000_000 };
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect((await chaveiroDaResposta(res))?.contas.map((c) => c.uid)).toEqual(["u-mfs", "u-udn"]);
  });

  it("dono vinculando mais uma loja: soma ao chaveiro dele", async () => {
    aparelho.chaveiro = { contas: [{ uid: "u-mfs", v: 0 }, { uid: "u-zeta", v: 0 }], exp: 4_000_000_000 };
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect((await chaveiroDaResposta(res))?.contas.map((c) => c.uid)).toEqual(["u-mfs", "u-zeta", "u-udn"]);
  });

  it("conta com 2FA: pede o código, com o desafio amarrado a esta sessão", async () => {
    dbMock.usuario.findUnique.mockResolvedValue({ ...contaUdn(), twoFactorEnabled: true, twoFactorMethod: "EMAIL" });
    desafio.criarDesafio2FA.mockResolvedValueOnce({ challengeId: "c".repeat(32), metodo: "EMAIL" });
    const res = await chamar({ email: "udn@loja.test", senha: "senha-certa" });
    expect(await res.json()).toEqual({ requires2FA: true, challengeId: "c".repeat(32), metodo: "EMAIL" });
    expect(desafio.criarDesafio2FA).toHaveBeenCalledWith(expect.objectContaining({ id: "u-udn" }), "VINCULO:u-mfs");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("conta da mesma loja com 2FA: recusa antes de mandar código", async () => {
    dbMock.usuario.findUnique.mockResolvedValue({
      ...contaUdn(),
      id: "u-mfs2",
      empresaId: "mundofs",
      twoFactorEnabled: true,
      twoFactorMethod: "EMAIL",
    });
    const res = await chamar({ email: "outro@mundofs.test", senha: "senha-certa" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: "MESMA_LOJA" });
    expect(desafio.criarDesafio2FA).not.toHaveBeenCalled();
  });

  it("mesma loja detectada no serviço: 400 MESMA_LOJA", async () => {
    vinculos.prepararVinculo.mockRejectedValueOnce(new vinculos.ErroVinculo("MESMA_LOJA"));
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
      expect(vinculos.prepararVinculo).not.toHaveBeenCalled();
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

  it("confere o desafio desta sessão e grava o chaveiro deste aparelho", async () => {
    desafio.conferirDesafio2FA.mockResolvedValueOnce({ ok: true, usuario: { id: "u-udn" } });
    const res = await chamar2fa();
    expect(res.status).toBe(200);
    expect(desafio.conferirDesafio2FA).toHaveBeenCalledWith(
      expect.objectContaining({ finalidade: "VINCULO:u-mfs" }),
    );
    expect((await chaveiroDaResposta(res))?.contas.map((c) => c.uid)).toEqual(["u-mfs", "u-udn"]);
  });

  it("código errado ou desafio de outra sessão: 401 e nenhum chaveiro", async () => {
    desafio.conferirDesafio2FA.mockResolvedValueOnce({ ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
    const res = await chamar2fa();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erro: "CODIGO_INVALIDO_OU_EXPIRADO" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
