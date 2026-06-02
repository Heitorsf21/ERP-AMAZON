import { describe, it, expect } from "vitest";
import { calcularTotaisCompras } from "./totais";
import { StatusPedidoCompra } from "@/modules/shared/domain";

const de = new Date("2026-05-01T00:00:00.000Z");
const ate = new Date("2026-05-31T23:59:59.999Z");

describe("calcularTotaisCompras", () => {
  it("soma comprado no periodo (exclui cancelado e fora do periodo) e calcula ticket medio", () => {
    const r = calcularTotaisCompras(
      [
        {
          totalCentavos: 1000,
          status: StatusPedidoCompra.RECEBIDO,
          dataEmissao: new Date("2026-05-10"),
          dataRecebimento: new Date("2026-05-15"),
        },
        {
          totalCentavos: 3000,
          status: StatusPedidoCompra.CONFIRMADO,
          dataEmissao: new Date("2026-05-20"),
          dataRecebimento: null,
        },
        {
          totalCentavos: 9999,
          status: StatusPedidoCompra.CANCELADO,
          dataEmissao: new Date("2026-05-21"),
          dataRecebimento: null,
        },
        {
          totalCentavos: 5000,
          status: StatusPedidoCompra.RECEBIDO,
          dataEmissao: new Date("2026-04-10"),
          dataRecebimento: new Date("2026-04-12"),
        },
      ],
      de,
      ate,
    );
    expect(r.compradoNoPeriodoCentavos).toBe(4000);
    expect(r.pedidosNoPeriodo).toBe(2);
    expect(r.ticketMedioCentavos).toBe(2000);
  });

  it("a receber = confirmados sem recebimento (independe do periodo)", () => {
    const r = calcularTotaisCompras(
      [
        {
          totalCentavos: 3000,
          status: StatusPedidoCompra.CONFIRMADO,
          dataEmissao: new Date("2026-05-20"),
          dataRecebimento: null,
        },
        {
          totalCentavos: 2000,
          status: StatusPedidoCompra.CONFIRMADO,
          dataEmissao: new Date("2026-05-20"),
          dataRecebimento: new Date("2026-05-25"),
        },
      ],
      de,
      ate,
    );
    expect(r.aReceberCentavos).toBe(3000);
  });

  it("conta rascunhos e devolve ticket medio nulo sem pedidos no periodo", () => {
    const r = calcularTotaisCompras(
      [
        {
          totalCentavos: 1000,
          status: StatusPedidoCompra.RASCUNHO,
          dataEmissao: new Date("2026-01-01"),
          dataRecebimento: null,
        },
      ],
      de,
      ate,
    );
    expect(r.rascunho).toBe(1);
    expect(r.ticketMedioCentavos).toBeNull();
    expect(r.compradoNoPeriodoCentavos).toBe(0);
  });
});
