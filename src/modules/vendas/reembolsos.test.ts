import { describe, expect, it } from "vitest";
import { calcularResumoReembolsos } from "./reembolsos";

describe("calcularResumoReembolsos", () => {
  it("calcula taxa por produto usando pedidos unicos vendidos no periodo", () => {
    const resumo = calcularResumoReembolsos(
      [
        {
          amazonOrderId: "701-1",
          sku: "SKU-1",
          titulo: "Produto 1",
          quantidade: 2,
          precoUnitarioCentavos: 1000,
          valorBrutoCentavos: null,
        },
        {
          amazonOrderId: "701-2",
          sku: "SKU-1",
          titulo: "Produto 1",
          quantidade: 1,
          precoUnitarioCentavos: 1500,
          valorBrutoCentavos: 1500,
        },
      ],
      [
        {
          amazonOrderId: "701-2",
          sku: "SKU-1",
          titulo: "Produto 1",
          quantidade: 1,
          valorReembolsadoCentavos: 1500,
        },
      ],
    );

    expect(resumo).toHaveLength(1);
    expect(resumo[0]).toMatchObject({
      sku: "SKU-1",
      pedidosVendidos: 2,
      pedidosReembolsados: 1,
      unidadesVendidas: 3,
      unidadesReembolsadas: 1,
      valorVendidoCentavos: 3500,
      valorReembolsadoCentavos: 1500,
    });
    expect(resumo[0]?.taxaReembolso).toBe(50);
  });

  it("contabiliza reembolso mesmo sem a venda na base (pedido totalmente reembolsado)", () => {
    // Regressao: pedido totalmente reembolsado -> a VendaAmazon vira REEMBOLSADO
    // e sai da base de vendas. O reembolso (vindo por dataReembolso) AINDA deve
    // ser contabilizado. (O bug antigo buscava reembolso por orderId das vendas,
    // entao esses reembolsos sumiam.)
    const resumo = calcularResumoReembolsos(
      [],
      [
        {
          amazonOrderId: "701-9",
          sku: "SKU-9",
          titulo: "Produto 9",
          quantidade: 1,
          valorReembolsadoCentavos: 4500,
        },
      ],
    );

    expect(resumo).toHaveLength(1);
    expect(resumo[0]).toMatchObject({
      sku: "SKU-9",
      pedidosVendidos: 0,
      pedidosReembolsados: 1,
      unidadesReembolsadas: 1,
      valorReembolsadoCentavos: 4500,
    });
    expect(resumo[0]?.taxaReembolso).toBe(0);
  });
});
