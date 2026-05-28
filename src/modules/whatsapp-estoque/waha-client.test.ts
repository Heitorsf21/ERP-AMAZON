import { describe, expect, it } from "vitest";
import { mascararDestino, normalizarChatId } from "./waha-client";

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
