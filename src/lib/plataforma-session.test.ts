import { describe, it, expect, beforeAll } from "vitest";
import { signPlataformaSession, verifyPlataformaSession } from "./plataforma-session";

beforeAll(() => { process.env.PLATAFORMA_SESSION_SECRET = "x".repeat(48); });

describe("plataforma-session", () => {
  it("assina e verifica round-trip", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signPlataformaSession({ puid: "p1", email: "a@b.com", nome: "A", v: 0, exp });
    const payload = await verifyPlataformaSession(token);
    expect(payload?.puid).toBe("p1");
  });
  it("rejeita assinatura adulterada", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await signPlataformaSession({ puid: "p1", email: "a@b.com", nome: "A", v: 0, exp });
    expect(await verifyPlataformaSession(token + "x")).toBeNull();
  });
  it("rejeita expirado", async () => {
    const token = await signPlataformaSession({ puid: "p1", email: "a@b.com", nome: "A", v: 0, exp: 1 });
    expect(await verifyPlataformaSession(token)).toBeNull();
  });
});
