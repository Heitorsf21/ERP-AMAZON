import { describe, expect, it } from "vitest";
import { atualizarProdutoSchema, criarProdutoSchema } from "@/modules/estoque/schemas";

describe("estoque schemas: amazonCategoriaFee", () => {
  it("aceita slug valido no cadastro", () => {
    const parsed = criarProdutoSchema.parse({
      sku: "MFS-TESTE",
      nome: "Produto teste",
      amazonCategoriaFee: "cozinha",
    });

    expect(parsed.amazonCategoriaFee).toBe("cozinha");
  });

  it("converte string vazia em null", () => {
    const parsed = atualizarProdutoSchema.parse({
      amazonCategoriaFee: "",
    });

    expect(parsed.amazonCategoriaFee).toBeNull();
  });

  it("rejeita slug desconhecido", () => {
    expect(() =>
      atualizarProdutoSchema.parse({
        amazonCategoriaFee: "categoria-inventada",
      }),
    ).toThrow(/Categoria de comissao Amazon invalida/);
  });
});

