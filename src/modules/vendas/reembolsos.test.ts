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
});
