import { describe, expect, it } from "vitest";
import { FaixaEstoque } from "./schemas";
import { classificarFaixa, montarResumoDeDados } from "./service";

describe("classificarFaixa", () => {
  it("classifica pelo valor arredondado para baixo", () => {
    expect(classificarFaixa(10)).toBe(FaixaEstoque.CRITICO);
    expect(classificarFaixa(15.9)).toBe(FaixaEstoque.CRITICO);
    expect(classificarFaixa(16)).toBe(FaixaEstoque.ATENCAO);
    expect(classificarFaixa(30.4)).toBe(FaixaEstoque.ATENCAO);
    expect(classificarFaixa(31)).toBe(FaixaEstoque.ESTAVEL);
    expect(classificarFaixa(59.9)).toBe(FaixaEstoque.ESTAVEL);
    expect(classificarFaixa(60)).toBe(FaixaEstoque.SEGURO);
    expect(classificarFaixa(200)).toBe(FaixaEstoque.SEGURO);
  });
});

const produtos = [
  { id: "a", sku: "SKU-A", nome: "Produto A", estoqueAtual: 10 }, // 10d CRITICO
  { id: "b", sku: "SKU-B", nome: "Produto B", estoqueAtual: 100 }, // 100d SEGURO
  { id: "c", sku: "SKU-C", nome: "Produto C", estoqueAtual: 50 }, // 50d ESTAVEL
  { id: "d", sku: "SKU-D", nome: "Produto D", estoqueAtual: 20 }, // 20d ATENCAO
  { id: "e", sku: "SKU-E", nome: "Produto E", estoqueAtual: 5 }, // excluido
  { id: "f", sku: "SKU-F", nome: "Produto F", estoqueAtual: 999 }, // sem venda
];

// vendas 30d = 30 -> mediaDia 1 -> diasEstoque = estoqueAtual
const vendasPorSku = new Map([
  ["SKU-A", 30],
  ["SKU-B", 30],
  ["SKU-C", 30],
  ["SKU-D", 30],
  ["SKU-E", 30],
  ["SKU-F", 0],
]);

describe("montarResumoDeDados", () => {
  it("ignora produtos sem venda e produtos excluidos", () => {
    const resumo = montarResumoDeDados({
      produtos,
      vendasPorSku,
      excluidosIds: new Set(["e"]),
    });
    const skus = resumo.itens.map((i) => i.sku);
    expect(skus).not.toContain("SKU-F"); // sem venda
    expect(skus).not.toContain("SKU-E"); // excluido
    expect(resumo.totalProdutos).toBe(4);
  });

  it("ordena globalmente por menor cobertura", () => {
    const resumo = montarResumoDeDados({
      produtos,
      vendasPorSku,
      excluidosIds: new Set(["e"]),
    });
    expect(resumo.itens.map((i) => i.sku)).toEqual([
      "SKU-A",
      "SKU-D",
      "SKU-C",
      "SKU-B",
    ]);
  });

  it("agrupa por faixa e calcula totais", () => {
    const resumo = montarResumoDeDados({
      produtos,
      vendasPorSku,
      excluidosIds: new Set(["e"]),
    });
    expect(resumo.porFaixa[FaixaEstoque.CRITICO].map((i) => i.sku)).toEqual([
      "SKU-A",
    ]);
    expect(resumo.porFaixa[FaixaEstoque.ATENCAO].map((i) => i.sku)).toEqual([
      "SKU-D",
    ]);
    expect(resumo.porFaixa[FaixaEstoque.ESTAVEL].map((i) => i.sku)).toEqual([
      "SKU-C",
    ]);
    expect(resumo.porFaixa[FaixaEstoque.SEGURO].map((i) => i.sku)).toEqual([
      "SKU-B",
    ]);
    expect(resumo.totais).toEqual({
      CRITICO: 1,
      ATENCAO: 1,
      ESTAVEL: 1,
      SEGURO: 1,
    });
  });

  it("expoe cobertura arredondada e media diaria", () => {
    const resumo = montarResumoDeDados({
      produtos: [{ id: "x", sku: "SKU-X", nome: "X", estoqueAtual: 25 }],
      vendasPorSku: new Map([["SKU-X", 30]]),
      excluidosIds: new Set(),
    });
    const item = resumo.itens[0]!;
    expect(item.mediaDia).toBeCloseTo(1);
    expect(item.coberturaDias).toBe(25);
    expect(item.faixa).toBe(FaixaEstoque.ATENCAO);
  });
});
