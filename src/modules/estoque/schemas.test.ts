import { describe, expect, it } from "vitest";
import {
  atualizarProdutoSchema,
  criarProdutoSchema,
  filtrosProdutoSchema,
} from "@/modules/estoque/schemas";
import { EstoqueFiltroOperacional } from "@/modules/estoque/filtros";

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

describe("estoque schemas: filtros operacionais", () => {
  it("converte flags de query string para booleanos", () => {
    const parsed = filtrosProdutoSchema.parse({
      ativo: "true",
      estoque: EstoqueFiltroOperacional.COM_ESTOQUE,
      semCusto: "true",
      semSyncAmazon: "false",
    });

    expect(parsed).toMatchObject({
      ativo: true,
      estoque: EstoqueFiltroOperacional.COM_ESTOQUE,
      semCusto: true,
      semSyncAmazon: false,
    });
  });

  it("rejeita modo de estoque desconhecido", () => {
    expect(() =>
      filtrosProdutoSchema.parse({
        estoque: "QUALQUER",
      }),
    ).toThrow();
  });
});
