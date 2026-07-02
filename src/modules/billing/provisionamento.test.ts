import { describe, expect, it } from "vitest";
import { slugificarNome } from "./provisionamento";

describe("slugificarNome", () => {
  it("converte nome com acentos e espaços em slug", () => {
    expect(slugificarNome("Fernandes & Santos Empreendimentos")).toBe(
      "fernandes-santos-empreendiment",
    );
  });

  it("remove acentuação", () => {
    expect(slugificarNome("Açaí do João")).toBe("acai-do-joao");
  });

  it("corta em 30 caracteres sem terminar em hífen", () => {
    const slug = slugificarNome("Loja Muito Grande De Nome Comprido Demais LTDA ME");
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug).toMatch(/^[a-z0-9-]{3,30}$/);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("garante mínimo de 3 caracteres com prefixo loja", () => {
    expect(slugificarNome("A")).toBe("loja-a");
    expect(slugificarNome("")).toBe("loja");
    expect(slugificarNome("!!")).toBe("loja");
  });
});
