/**
 * Regression: orderItemsFromOrderSummary deve devolver `ItemPrice` como
 * TOTAL DA LINHA (preço unitário × quantidade), nunca como unitário cru.
 *
 * Bug histórico: o summary da Amazon Orders API entrega `product.price` por
 * UNIDADE, mas o consumidor (`calcularValorBrutoOrderItemCentavos` em
 * `pricing.ts`) trata `ItemPrice` como total da linha. Quando o pedido só
 * tinha summary (sem `getOrderItems` detalhado), gravávamos
 * `valorBrutoCentavos = preço unitário` em vendas multi-unidade, gerando
 * margem absurdamente negativa nos cards.
 */
import { describe, expect, it } from "vitest";
import { orderItemsFromOrderSummary } from "./service";
import { skusSomenteComQuantidadeZero } from "./zero-quantity-cancellation";

describe("orderItemsFromOrderSummary — ItemPrice como total da linha", () => {
  it("multiplica product.price unitário pela quantidade (qty=3)", () => {
    // Reproduz o caso do pedido 701-2310526-4297041 (MFS-0025+2, qty 3,
    // unit R$ 41,57 → total real R$ 124,71).
    const items = orderItemsFromOrderSummary({
      orderItems: [
        {
          SellerSKU: "MFS-0025+2",
          QuantityOrdered: 3,
          product: { price: { Amount: "41.57", CurrencyCode: "BRL" } },
        },
      ],
    } as never);

    expect(items).toHaveLength(1);
    expect(items[0]?.SellerSKU).toBe("MFS-0025+2");
    expect(items[0]?.QuantityOrdered).toBe(3);
    expect(items[0]?.ItemPrice?.Amount).toBe("124.71");
    expect(items[0]?.ItemPrice?.CurrencyCode).toBe("BRL");
  });

  it("aceita price em record.price (não em product.price)", () => {
    const items = orderItemsFromOrderSummary({
      orderItems: [
        {
          SellerSKU: "MFS-0010",
          QuantityOrdered: 2,
          price: { Amount: "50.00", CurrencyCode: "BRL" },
        },
      ],
    } as never);

    expect(items[0]?.ItemPrice?.Amount).toBe("100.00");
  });

  it("preserva valor quando quantidade é 1 (sem regressão)", () => {
    const items = orderItemsFromOrderSummary({
      orderItems: [
        {
          SellerSKU: "MFS-0001",
          QuantityOrdered: 1,
          product: { price: { Amount: "89.99", CurrencyCode: "BRL" } },
        },
      ],
    } as never);

    expect(items[0]?.ItemPrice?.Amount).toBe("89.99");
  });

  it("ItemPrice ausente quando product.price não existe", () => {
    const items = orderItemsFromOrderSummary({
      orderItems: [
        {
          SellerSKU: "MFS-0002",
          QuantityOrdered: 2,
        },
      ],
    } as never);

    expect(items[0]?.ItemPrice).toBeUndefined();
  });

  it("aceita price numérico direto", () => {
    const items = orderItemsFromOrderSummary({
      orderItems: [
        {
          SellerSKU: "MFS-0003",
          QuantityOrdered: 4,
          product: { price: 25 },
        },
      ],
    } as never);

    expect(items[0]?.ItemPrice?.Amount).toBe("100.00");
  });
  it("preserva quantityOrdered=0 sem inventar venda unitaria", () => {
    const items = orderItemsFromOrderSummary({
      orderItems: [
        {
          sellerSku: "MFS-0039",
          quantityOrdered: 0,
          product: {
            price: { unitPrice: { amount: "71.97", currencyCode: "BRL" } },
          },
        },
      ],
    } as never);

    expect(items[0]?.QuantityOrdered).toBe(0);
    expect(items[0]?.ItemPrice).toBeUndefined();
  });
});

/**
 * Regressão: pedido CANCELADO que já tinha preço real (precoOrigem "sp-api")
 * pulava o getOrderItems (otimização "dadosCompletos") e o status-only update
 * era no-op (o endpoint /orders/2026-01-01/orders NÃO retorna OrderStatus).
 * O pedido ficava preso em "Pending" e seguia contando no faturamento.
 *
 * A lista JÁ traz `orderItems` com `quantityOrdered = 0` no cancelamento — a
 * detecção precisa vir dela. Reproduz o payload real de 702-1000699-0957830.
 */
describe("detecção de cancelamento pelo order summary (endpoint 2026-01-01)", () => {
  it("payload real do cancelado (sku em product, quantityOrdered 0) → marca SKU cancelado", () => {
    const order = {
      orderId: "702-1000699-0957830",
      orderItems: [
        {
          product: {
            sellerSku: "MFS-0034",
            price: { unitPrice: { amount: "35.97", currencyCode: "BRL" } },
          },
          quantityOrdered: 0,
        },
      ],
    } as never;

    const itens = orderItemsFromOrderSummary(order).filter((i) => !!i.SellerSKU);
    const skusZero = skusSomenteComQuantidadeZero(
      itens.map((i) => ({ sku: i.SellerSKU, quantidade: i.QuantityOrdered ?? 0 })),
    );
    expect(skusZero).toEqual(["MFS-0034"]);
  });

  it("pedido ativo (quantityOrdered > 0) NÃO é marcado como cancelado", () => {
    const order = {
      orderId: "111-2222222-3333333",
      orderItems: [
        {
          product: {
            sellerSku: "MFS-0017",
            price: { unitPrice: { amount: "65.97", currencyCode: "BRL" } },
          },
          quantityOrdered: 1,
        },
      ],
    } as never;

    const itens = orderItemsFromOrderSummary(order).filter((i) => !!i.SellerSKU);
    const skusZero = skusSomenteComQuantidadeZero(
      itens.map((i) => ({ sku: i.SellerSKU, quantidade: i.QuantityOrdered ?? 0 })),
    );
    expect(skusZero).toEqual([]);
  });
});
