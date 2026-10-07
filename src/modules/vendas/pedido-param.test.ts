import { describe, expect, it } from "vitest";
import { normalizarPedidoParam } from "./pedido-param";

describe("normalizarPedidoParam", () => {
  it("aceita o formato de pedido da Amazon (com espaços em volta)", () => {
    expect(normalizarPedidoParam("702-4417820-3391045")).toBe("702-4417820-3391045");
    expect(normalizarPedidoParam("  702-4417820-3391045 ")).toBe("702-4417820-3391045");
  });

  it("rejeita vazio, lixo e tentativa de injeção", () => {
    expect(normalizarPedidoParam(null)).toBeNull();
    expect(normalizarPedidoParam("")).toBeNull();
    expect(normalizarPedidoParam("702-441")).toBeNull();
    expect(normalizarPedidoParam("702-4417820-3391045' OR 1=1")).toBeNull();
  });
});
