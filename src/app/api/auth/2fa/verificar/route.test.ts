import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const dbMock = vi.hoisted(() => ({
  codigoVerificacao2FA: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  usuario: { update: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { POST } from "./route";

process.env.SESSION_SECRET = "x".repeat(48);

async function desafio(finalidade: string) {
  return {
    id: "c1",
    usuarioId: "u-udn",
    codigoHash: await bcrypt.hash("123456", 4),
    metodo: "EMAIL",
    finalidade,
    challengeId: "abcdef0123456789",
    expiresAt: new Date(Date.now() + 60_000),
    usadoEm: null,
    tentativas: 0,
    usuario: {
      id: "u-udn",
      email: "loja@udn.test",
      nome: "UDN",
      role: "ADMIN",
      ativo: true,
      avatarUrl: null,
      sessionVersion: 0,
      empresaId: "udn",
      totpSecretEnc: null,
    },
  };
}

function chamar() {
  return POST(
    new Request("http://localhost/api/auth/2fa/verificar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "abcdef0123456789", codigo: "123456" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.codigoVerificacao2FA.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/auth/2fa/verificar", () => {
  it("código pedido para vincular loja não abre sessão", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio("VINCULO:u-mfs"));
    const res = await chamar();
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("código de login certo abre a sessão da conta", async () => {
    dbMock.codigoVerificacao2FA.findUnique.mockResolvedValue(await desafio("LOGIN"));
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("erp_session=");
    expect(dbMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u-udn" } }),
    );
  });
});
