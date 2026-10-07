import { beforeAll, describe, expect, it } from "vitest";
import { assinarComRotulo, signSession, verificarComRotulo, verifySession } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "r".repeat(48);
});

describe("assinatura com rótulo (separada da sessão)", () => {
  it("assina e confere com o mesmo rótulo", async () => {
    const token = await assinarComRotulo({ contas: [{ uid: "u1", v: 0 }], exp: 1 }, "chaveiro-lojas");
    expect(await verificarComRotulo(token, "chaveiro-lojas")).toEqual({ contas: [{ uid: "u1", v: 0 }], exp: 1 });
  });

  it("um token com rótulo NÃO vale como sessão, e uma sessão NÃO vale como token com rótulo", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const rotulado = await assinarComRotulo({ uid: "u1", email: "x", nome: "x", role: "ADMIN", exp }, "chaveiro-lojas");
    expect(await verifySession(rotulado)).toBeNull();
    const sessao = await signSession({ uid: "u1", email: "x", nome: "x", role: "ADMIN", exp });
    expect(await verificarComRotulo(sessao, "chaveiro-lojas")).toBeNull();
  });

  it("rótulo diferente ou token adulterado não confere", async () => {
    const token = await assinarComRotulo({ a: 1 }, "chaveiro-lojas");
    expect(await verificarComRotulo(token, "outro")).toBeNull();
    expect(await verificarComRotulo(`${token}x`, "chaveiro-lojas")).toBeNull();
    expect(await verificarComRotulo(undefined, "chaveiro-lojas")).toBeNull();
  });
});
