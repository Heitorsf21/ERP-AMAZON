import { describe, expect, it } from "vitest";
import {
  dataVendaPeriodoSP,
  isVendaAmazonContabilizavel,
  isVendaAmazonPrincipal,
  isVendaAmazonRemovalOrder,
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
        valorBrutoCentavos: 4990,
      }),
    ).toBe(true);
  });

  it("nao contabiliza pedido pendente zerado mesmo com status financeiro diferente", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Pending",
        statusFinanceiro: "DEFERRED",
        valorBrutoCentavos: 0,
      }),
    ).toBe(false);
  });

  it("inclui pedidos pendentes na visao principal", () => {
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Pending",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(true);
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "PendingAvailability",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(true);
  });

  it("separa apenas cancelados e reembolsados da visao principal", () => {
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Canceled",
        statusFinanceiro: "PENDENTE",
      }),
    ).toBe(false);
    expect(
      isVendaAmazonPrincipal({
        statusPedido: "Shipped",
        statusFinanceiro: "REFUNDED",
      }),
    ).toBe(false);
  });

  it("contabiliza pedidos enviados", () => {
    expect(
      isVendaAmazonContabilizavel({
        statusPedido: "Shipped",
        statusFinanceiro: "DEFERRED",
      }),
    ).toBe(true);
  });

  it("identifica e remove pedidos S01/Non-Amazon da visao de venda", () => {
    const removal = {
      amazonOrderId: "S01-6716734-6047108",
      marketplace: "Non-Amazon",
      statusPedido: "Shipped",
      statusFinanceiro: "PENDENTE",
      valorBrutoCentavos: 94975,
    };

    expect(isVendaAmazonRemovalOrder(removal)).toBe(true);
    expect(isVendaAmazonContabilizavel(removal)).toBe(false);
    expect(isVendaAmazonPrincipal(removal)).toBe(false);
  });

  it("recorta datas usando o dia civil de Sao Paulo", () => {
    const filtro = dataVendaPeriodoSP("2026-04-27", "2026-04-27");

    expect(filtro?.gte).toEqual(new Date("2026-04-27T03:00:00.000Z"));
    expect(filtro?.lte).toEqual(new Date("2026-04-28T02:59:59.999Z"));
  });
});
