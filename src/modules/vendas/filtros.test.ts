import { describe, expect, it } from "vitest";
import {
  dataVendaPeriodoSP,
  isVendaAmazonContabilizavel,
} from "./filtros";

describe("filtros de vendas Amazon", () => {
  it("nao contabiliza pedido pendente sem confirmacao financeira", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Pending",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(false);
  });

  it("contabiliza pedido pendente quando ja tem confirmacao financeira", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Pending",
        statusFinanceiro: "DEFERRED",
      }),
    ).toBe(true);
  });

  it("contabiliza pedidos enviados", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Shipped",
        statusFinanceiro: "DEFERRED",
      }),
    ).toBe(true);
  });

  it("recorta datas usando o dia civil de Sao Paulo", () => {
    const filtro = dataVendaPeriodoSP("2026-04-27", "2026-04-27");

    expect(filtro?.gte).toEqual(new Date("2026-04-27T03:00:00.000Z"));
    expect(filtro?.lte).toEqual(new Date("2026-04-28T02:59:59.999Z"));
  });
});
