import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifySession } from "@/lib/session";

process.env.SESSION_SECRET = "s".repeat(48);

const agoraSeg = Math.floor(Date.now() / 1000);
const sessao = vi.hoisted(() => ({
  atual: {
    uid: "u-mfs",
    email: "mfs@loja.test",
    nome: "Heitor",
    role: "ADMIN",
    exp: 0,
    v: 0,
    empresaId: "mundofs",
  },
}));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => sessao.atual) }));

const vinculos = vi.hoisted(() => ({ contaVinculadaNaEmpresa: vi.fn() }));
vi.mock("@/modules/lojas/vinculos", () => vinculos);

const dbMock = vi.hoisted(() => ({ usuario: { update: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: dbMock }));

const audit = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => audit);

import { POST } from "./route";

function chamar(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/auth/trocar-loja", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function tokenDoCookie(setCookie: string | null): string {
  const m = /erp_session=([^;]+)/.exec(setCookie ?? "");
  return m?.[1] ?? "";
}

const contaUdn = {
  id: "u-udn",
  email: "udn@loja.test",
  nome: "Loja UDN",
  role: "OPERADOR",
  ativo: true,
  sessionVersion: 4,
  empresaId: "udn",
  empresa: { nome: "UDN", ativa: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessao.atual.exp = agoraSeg + 3 * 24 * 3600;
});

describe("POST /api/auth/trocar-loja", () => {
  it("sem vínculo com a loja pedida: 404 e nenhum cookie", async () => {
    vinculos.contaVinculadaNaEmpresa.mockResolvedValueOnce(null);
    const res = await chamar({ empresaId: "zeta" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ erro: "LOJA_NAO_VINCULADA" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("com vínculo: cookie da conta da outra loja, com o mesmo prazo da sessão atual", async () => {
    vinculos.contaVinculadaNaEmpresa.mockResolvedValueOnce(contaUdn);
    const res = await chamar({ empresaId: "udn" });
    expect(res.status).toBe(200);
    expect(vinculos.contaVinculadaNaEmpresa).toHaveBeenCalledWith("u-mfs", "udn");
    const setCookie = res.headers.get("set-cookie");
    const payload = await verifySession(tokenDoCookie(setCookie));
    expect(payload).toMatchObject({
      uid: "u-udn",
      email: "udn@loja.test",
      role: "OPERADOR",
      v: 4,
      empresaId: "udn",
      exp: sessao.atual.exp,
    });
    const maxAge = Number(/Max-Age=(\d+)/i.exec(setCookie ?? "")?.[1]);
    expect(maxAge).toBeGreaterThan(3 * 24 * 3600 - 60);
    expect(maxAge).toBeLessThanOrEqual(3 * 24 * 3600);
    expect(await res.json()).toEqual({ ok: true, loja: { empresaId: "udn", nome: "UDN" } });
  });

  it("registra a troca na auditoria", async () => {
    vinculos.contaVinculadaNaEmpresa.mockResolvedValueOnce(contaUdn);
    await chamar({ empresaId: "udn" });
    expect(audit.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "LOJA_TROCADA",
        entidadeId: "u-udn",
        metadata: { deEmpresa: "mundofs", paraEmpresa: "udn" },
      }),
    );
  });

  it("corpo inválido: 400", async () => {
    const res = await chamar({ empresaId: "" });
    expect(res.status).toBe(400);
  });

  it("origem de outro site é bloqueada", async () => {
    const antes = { enforce: process.env.CSRF_ENFORCE_ORIGIN, app: process.env.APP_URL };
    process.env.CSRF_ENFORCE_ORIGIN = "true";
    process.env.APP_URL = "https://erp.mundofs.cloud";
    try {
      const res = await chamar({ empresaId: "udn" }, { origin: "https://malicioso.example" });
      expect(res.status).toBe(403);
      expect(vinculos.contaVinculadaNaEmpresa).not.toHaveBeenCalled();
    } finally {
      process.env.CSRF_ENFORCE_ORIGIN = antes.enforce;
      process.env.APP_URL = antes.app;
    }
  });
});
