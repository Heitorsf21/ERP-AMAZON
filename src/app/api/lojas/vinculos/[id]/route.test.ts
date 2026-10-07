import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ uid: "u-mfs", email: "mfs@loja.test", nome: "H", role: "LEITURA", exp: 0, empresaId: "mundofs" })),
}));

const aparelho = vi.hoisted(() => ({ chaveiro: null as null | { contas: { uid: string; v: number }[]; exp: number } }));
vi.mock("@/modules/lojas/chaveiro", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/lojas/chaveiro")>();
  return { ...real, chaveiroDoRequest: vi.fn(async () => aparelho.chaveiro) };
});

const audit = vi.hoisted(() => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => audit);

import { lerChaveiro } from "@/modules/lojas/chaveiro";
import { DELETE } from "./route";

beforeAll(() => {
  process.env.SESSION_SECRET = "d".repeat(48);
});

function chamar(id: string) {
  return DELETE(new Request(`http://localhost/api/lojas/vinculos/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

function cookieChaveiro(res: Response) {
  return /erp_lojas=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  aparelho.chaveiro = {
    contas: [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }, { uid: "u-zeta", v: 0 }],
    exp: 4_000_000_000,
  };
});

describe("DELETE /api/lojas/vinculos/[id] (desvincula neste aparelho)", () => {
  it("tira a loja do chaveiro deste aparelho (qualquer papel) e audita", async () => {
    const res = await chamar("u-udn");
    expect(res.status).toBe(200);
    expect((await lerChaveiro(cookieChaveiro(res)))?.contas.map((c) => c.uid)).toEqual(["u-mfs", "u-zeta"]);
    expect(audit.auditLog).toHaveBeenCalledWith(expect.objectContaining({ acao: "LOJA_DESVINCULADA", entidadeId: "u-udn" }));
  });

  it("sobrando só a própria conta, o chaveiro é apagado", async () => {
    aparelho.chaveiro = { contas: [{ uid: "u-mfs", v: 0 }, { uid: "u-udn", v: 0 }], exp: 4_000_000_000 };
    const res = await chamar("u-udn");
    expect(res.status).toBe(200);
    expect(cookieChaveiro(res)).toBe("");
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("loja que não está no chaveiro deste aparelho, ou a própria conta: 404", async () => {
    expect((await chamar("u-alheia")).status).toBe(404);
    expect((await chamar("u-mfs")).status).toBe(404);
    aparelho.chaveiro = null;
    expect((await chamar("u-udn")).status).toBe(404);
    expect(audit.auditLog).not.toHaveBeenCalled();
  });
});
