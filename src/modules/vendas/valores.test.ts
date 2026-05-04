import { describe, expect, it } from "vitest";
import { agruparLinhasVendaAmazon } from "@/modules/vendas/agrupamento";
import {
  calcularPrecoUnitarioCentavos,
  valorBrutoDaVenda,
  valorBrutoFinanceiroPodeAtualizar,
} from "@/modules/vendas/valores";

describe("valores de VendaAmazon", () => {
  it("usa valor bruto salvo e calcula fallback por unidade vezes quantidade", () => {
    expect(
      valorBrutoDaVenda({
        quantidade: 2,
        precoUnitarioCentavos: 5000,
        valorBrutoCentavos: 11000,
      }),
    ).toBe(11000);

    expect(
      valorBrutoDaVenda({
        quantidade: 2,
        precoUnitarioCentavos: 5000,
        valorBrutoCentavos: null,
      }),
    ).toBe(10000);
  });

  it("calcula preco unitario a partir do total da linha", () => {
    expect(calcularPrecoUnitarioCentavos(10000, 2)).toBe(5000);
    expect(calcularPrecoUnitarioCentavos(9999, 3)).toBe(3333);
  });

  it("agrupa multiplas linhas do mesmo pedido e SKU sem perder quantidade", () => {
    const linhas = agruparLinhasVendaAmazon([
      {
        amazonOrderId: "701-1",
        sku: "SKU-1",
        quantidade: 1,
        valorBrutoCentavos: 5000,
        taxasCentavos: 600,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 4400,
      },
      {
        amazonOrderId: "701-1",
        sku: "SKU-1",
        quantidade: 1,
        valorBrutoCentavos: 5000,
        taxasCentavos: 600,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 4400,
      },
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      quantidade: 2,
      valorBrutoCentavos: 10000,
      precoUnitarioCentavos: 5000,
      taxasCentavos: 1200,
      liquidoMarketplaceCentavos: 8800,
    });
  });

  it("mantem SKUs diferentes como linhas separadas no mesmo pedido", () => {
    const linhas = agruparLinhasVendaAmazon([
      {
        amazonOrderId: "701-2",
        sku: "SKU-A",
        quantidade: 1,
        valorBrutoCentavos: 3000,
      },
      {
        amazonOrderId: "701-2",
        sku: "SKU-B",
        quantidade: 1,
        valorBrutoCentavos: 7000,
      },
    ]);

    expect(linhas).toHaveLength(2);
    expect(linhas.reduce((sum, linha) => sum + linha.valorBrutoCentavos, 0)).toBe(
      10000,
    );
  });

  it("nao deixa o financeiro reduzir bruto valido em pedido com mais de uma unidade", () => {
    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: 10000,
        valorBrutoFinanceiroCentavos: 5000,
      }),
    ).toBe(false);

    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: 5000,
        valorBrutoFinanceiroCentavos: 10000,
      }),
    ).toBe(true);

    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: null,
        valorBrutoFinanceiroCentavos: 10000,
      }),
    ).toBe(true);
  });
});
