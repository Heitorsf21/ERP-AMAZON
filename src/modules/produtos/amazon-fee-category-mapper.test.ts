import { describe, expect, it } from "vitest";
import {
  inferAmazonCategoriaFee,
  __test_utils__,
} from "@/modules/produtos/amazon-fee-category-mapper";
import type { SPCatalogClassification, SPCatalogItem } from "@/lib/amazon-sp-api";

function catalogItem(partial: Partial<SPCatalogItem>): SPCatalogItem {
  return { asin: "B000TESTE", ...partial };
}

function chain(...names: string[]): SPCatalogClassification {
  const nodes: SPCatalogClassification[] = names.map((displayName) => ({ displayName }));
  for (let i = 0; i < nodes.length - 1; i += 1) {
    nodes[i]!.parent = nodes[i + 1];
  }
  return nodes[0]!;
}

describe("amazon-fee-category-mapper", () => {
  it("mapeia leaf Mixers pela arvore principal Cozinha", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              chain(
                "Mixers",
                "Batedeiras e Mixers",
                "Liquidificadores, Batedeiras e Processadores de Alimentos",
                "Eletroportateis",
                "Categorias",
                "Cozinha",
              ),
            ],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("cozinha");
    expect(result?.matchedText).toContain("Mixers");
  });

  it("mapeia bolsa de cabo como acessorio eletronico/PC pela arvore", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              chain(
                "Bolsas Organizadoras de Cabo",
                "Cabos e Acessorios",
                "Acessorios",
                "Categorias",
                "Computadores e Informatica",
              ),
            ],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("acessorios-eletronicos-pc");
  });

  it("mapeia potes e recipientes pela arvore Cozinha, nao por comida", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              chain(
                "Conteineres de Armazenamento de Alimentos",
                "Recipientes e Potes para Alimentos",
                "Armazenamento de Alimentos",
                "Organizacao",
                "Categorias",
                "Cozinha",
              ),
            ],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("cozinha");
  });

  it("mapeia mascara para dormir pela arvore Saude e Bem-Estar", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              chain(
                "Mascaras para Dormir",
                "Sono e Ronco",
                "Medicamentos e Remedios",
                "Categorias",
                "Saude e Bem-Estar",
              ),
            ],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("saude-cuidados-pessoais");
  });

  it("mapeia interfone pela arvore Ferramentas e Materiais de Construcao", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              chain(
                "Interfones",
                "Eletrica",
                "Categorias",
                "Ferramentas e Materiais de Construcao",
              ),
            ],
          },
        ],
      }),
    );

    expect(result?.slug).toBe("ferramentas-construcao");
  });

  it("usa productType como fallback quando nao ha arvore de classificacao", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        summaries: [{ productType: "LUXURY_BEAUTY" }],
      }),
    );

    expect(result?.slug).toBe("beleza-luxo");
  });

  it("nao transforma folha de bolsa de cabo em moda sem parent confiavel", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          { classifications: [{ displayName: "Bolsas Organizadoras de Cabo" }] },
        ],
      }),
    );

    expect(result).toBeNull();
    expect(
      __test_utils__.resolveTextSlug("Bolsas Organizadoras de Cabo", "classification"),
    ).toBeNull();
  });

  it("nao transforma conteiner de alimentos em Comidas e Bebidas sem parent confiavel", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              { displayName: "Conteineres de Armazenamento de Alimentos" },
            ],
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("nao escolhe categoria quando o texto e ambiguo", () => {
    expect(__test_utils__.resolveTextSlug("Casa e Cozinha", "classification")).toBeNull();
  });

  it("nao escolhe categoria quando classifications conflitam", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [
          {
            classifications: [
              chain("Produto", "Casa"),
              chain("Produto", "Cozinha"),
            ],
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("retorna null quando Amazon devolve categoria desconhecida", () => {
    const result = inferAmazonCategoriaFee(
      catalogItem({
        classifications: [{ classifications: [{ displayName: "Categoria Alienigena" }] }],
      }),
    );

    expect(result).toBeNull();
  });
});
