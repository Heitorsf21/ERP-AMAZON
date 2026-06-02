import { afterEach, describe, expect, it, vi } from "vitest";
import { enviarTextoWaha, mascararDestino, normalizarChatId } from "./waha-client";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizarChatId", () => {
  it("adiciona sufixo @c.us a numeros crus", () => {
    expect(normalizarChatId("5511999999999")).toBe("5511999999999@c.us");
  });

  it("remove formatacao antes de montar o chatId", () => {
    expect(normalizarChatId("+55 (11) 99999-9999")).toBe("5511999999999@c.us");
  });

  it("preserva chatId/group id que ja contem @", () => {
    expect(normalizarChatId("123456789@g.us")).toBe("123456789@g.us");
    expect(normalizarChatId("5511999999999@c.us")).toBe("5511999999999@c.us");
  });
});

describe("mascararDestino", () => {
  it("mantem apenas os ultimos 4 digitos", () => {
    expect(mascararDestino("5511999998888")).toBe("****8888");
  });

  it("mascara totalmente numeros muito curtos", () => {
    expect(mascararDestino("12")).toBe("****");
  });
});

describe("enviarTextoWaha SSRF guard", () => {
  const input = {
    baseUrl: "http://10.0.0.9:3002",
    session: "default",
    destino: "5511999999999",
    texto: "teste",
    timeoutMs: 1,
  };

  it("em producao bloqueia quando WAHA_ALLOWED_HOSTS esta ausente", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", undefined);

    const result = await enviarTextoWaha({ ...input, baseUrl: "http://127.0.0.1:3002" });

    expect(result.ok).toBe(false);
    expect(result.erro).toContain("bloqueada");
  });

  it("em producao bloqueia host fora da allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", "127.0.0.1:3002");

    const result = await enviarTextoWaha(input);

    expect(result.ok).toBe(false);
    expect(result.erro).toContain("bloqueada");
  });
});
