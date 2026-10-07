import { describe, expect, it } from "vitest";
import { formatBRL } from "@/lib/money";
import {
  agruparPorPedido,
  extrairResumoOrderChange,
  montarPayloadAgrupado,
  montarPayloadTeste,
  montarPayloadVenda,
  pedidoNotificavel,
} from "./regras";

const AGORA = new Date("2026-10-06T22:35:00Z");

describe("pedidoNotificavel", () => {
  it("pedido de agora há pouco avisa", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T22:33:10Z"), status: "Pending" }, AGORA)).toBe(true);
  });

  it("pedido com mais de 2 h não avisa (primeira conexão / worker voltando de queda)", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T20:30:00Z"), status: "Pending" }, AGORA)).toBe(false);
  });

  it("cancelado não avisa", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T22:30:00Z"), status: "Canceled" }, AGORA)).toBe(false);
  });

  it("sem data de compra não avisa (a reserva do ORDERS_SYNC cobre)", () => {
    expect(pedidoNotificavel({ purchaseDate: null, status: "Pending" }, AGORA)).toBe(false);
  });

  it("tolera relógio da Amazon alguns minutos à frente", () => {
    expect(pedidoNotificavel({ purchaseDate: new Date("2026-10-06T22:40:00Z"), status: "Unshipped" }, AGORA)).toBe(true);
  });
});

describe("texto do aviso", () => {
  const base = { loja: "MundoFS", amazonOrderId: "702-4417820-3391045", empresaId: "mundofs" };

  it("título com a loja e corpo com o valor", () => {
    const p = montarPayloadVenda({ ...base, valorCentavos: 20497, estimado: false });
    expect(p.title).toBe("Nova venda na MundoFS");
    expect(p.body).toBe(`Você teve uma nova venda de ${formatBRL(20497)}.`);
    expect(p.url).toBe("/vendas?pedido=702-4417820-3391045");
    expect(p.tag).toBe("venda-mundofs-702-4417820-3391045");
  });

  it("valor estimado ganha ~ e sem valor não inventa número", () => {
    expect(montarPayloadVenda({ ...base, valorCentavos: 7700, estimado: true }).body).toBe(
      `Você teve uma nova venda de ~${formatBRL(7700)}.`,
    );
    expect(montarPayloadVenda({ ...base, valorCentavos: null, estimado: true }).body).toBe(
      "Você teve uma nova venda.",
    );
  });

  it("o aviso só tem título, corpo, link e ícones (nunca produto/SKU/quantidade)", () => {
    const p = montarPayloadVenda({ ...base, valorCentavos: 7700, estimado: true });
    expect(Object.keys(p).sort()).toEqual(["badge", "body", "icon", "tag", "title", "url"]);
    expect(JSON.stringify(p)).not.toMatch(/MFS-|SKU|un\b/);
  });

  it("agrupado e teste", () => {
    const g = montarPayloadAgrupado({ loja: "UDN", quantidade: 4, totalCentavos: 35620, estimado: true, empresaId: "udncd" });
    expect(g.title).toBe("4 novas vendas na UDN");
    expect(g.body).toBe(`Total de ~${formatBRL(35620)}.`);
    expect(g.url).toBe("/vendas");
    expect(montarPayloadTeste("UDN").body).toBe("Os avisos de venda da UDN vão chegar assim.");
  });
});

describe("extrairResumoOrderChange", () => {
  it("lê pedido, data, status e itens do payload da Amazon", () => {
    const r = extrairResumoOrderChange({
      OrderChangeNotification: {
        AmazonOrderId: "702-4417820-3391045",
        Summary: {
          OrderStatus: "Pending",
          PurchaseDate: "2026-10-06T22:33:10Z",
          OrderItems: [
            { SellerSKU: "MFS-0036", Quantity: 1, OrderItemId: "1" },
            { SellerSKU: "MFS-0032", Quantity: 2, OrderItemId: "2" },
          ],
        },
      },
    });
    expect(r).toEqual({
      amazonOrderId: "702-4417820-3391045",
      purchaseDate: new Date("2026-10-06T22:33:10Z"),
      status: "Pending",
      itens: [
        { sku: "MFS-0036", quantidade: 1 },
        { sku: "MFS-0032", quantidade: 2 },
      ],
    });
  });

  it("payload sem pedido ou malformado devolve null", () => {
    expect(extrairResumoOrderChange(null)).toBeNull();
    expect(extrairResumoOrderChange({ OrderChangeNotification: { Summary: {} } })).toBeNull();
    expect(extrairResumoOrderChange({ OrderChangeNotification: "lixo" } as Record<string, unknown>)).toBeNull();
  });
});

describe("agruparPorPedido", () => {
  it("pedido com 2 SKUs vira 1 aviso com o valor somado", () => {
    const d = new Date("2026-10-06T22:00:00Z");
    const r = agruparPorPedido([
      { amazonOrderId: "A", purchaseDate: d, status: "Pending", valorBrutoCentavos: 7700, estimado: true },
      { amazonOrderId: "A", purchaseDate: d, status: "Pending", valorBrutoCentavos: 4997, estimado: false },
      { amazonOrderId: "B", purchaseDate: d, status: "Pending", valorBrutoCentavos: 0, estimado: true },
    ]);
    expect(r).toEqual([
      { amazonOrderId: "A", purchaseDate: d, status: "Pending", valorCentavos: 12697, estimado: true },
      { amazonOrderId: "B", purchaseDate: d, status: "Pending", valorCentavos: null, estimado: true },
    ]);
  });
});
