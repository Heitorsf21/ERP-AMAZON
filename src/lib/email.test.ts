import { describe, expect, it } from "vitest";
import { buildDevEmailLog, maskEmail } from "./email";

describe("maskEmail", () => {
  it("mantém os 2 primeiros caracteres do local-part e o domínio", () => {
    expect(maskEmail("joao.silva@example.com")).toBe("jo***@example.com");
  });

  it("mascara totalmente local-part curto", () => {
    expect(maskEmail("a@x.com")).toBe("***@x.com");
  });

  it("entrada sem @ vira máscara genérica (não vaza o valor)", () => {
    expect(maskEmail("naoehemail")).toBe("***");
  });
});

describe("buildDevEmailLog", () => {
  const input = {
    to: "user@example.com",
    subject: "Recuperação de senha",
    text: "Seu link: https://app/redefinir?token=SEGREDO123",
    html: '<a href="https://app/redefinir?token=SEGREDO123">x</a>',
  };

  it("por padrão NÃO inclui corpo/preview — não vaza token/link/código", () => {
    const log = buildDevEmailLog(input, { logBody: false });
    expect(log.to).toBe("us***@example.com");
    expect(log.subject).toBe("Recuperação de senha");
    expect("bodyPreview" in log).toBe(false);
    expect(JSON.stringify(log)).not.toContain("SEGREDO123");
  });

  it("só inclui preview do corpo com opt-in explícito (logBody=true)", () => {
    const log = buildDevEmailLog(input, { logBody: true });
    expect(log.bodyPreview).toContain("SEGREDO123");
  });
});
