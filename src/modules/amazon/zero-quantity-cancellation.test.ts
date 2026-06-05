import { describe, expect, it } from "vitest";
import {
  isStatusPedidoCancelado,
  skusSomenteComQuantidadeZero,
} from "./zero-quantity-cancellation";

describe("zero quantity cancellation", () => {
  it("seleciona apenas SKUs que vieram somente com quantidade zero", () => {
    expect(
      skusSomenteComQuantidadeZero([
        { sku: "MFS-0041", quantidade: 0 },
        { sku: "MFS-0042", quantidade: 2 },
        { sku: "MFS-0043", quantidade: -1 },
      ]),
    ).toEqual(["MFS-0041", "MFS-0043"]);
  });

  it("nao seleciona SKU zerado quando ha linha positiva no mesmo payload", () => {
    expect(
      skusSomenteComQuantidadeZero([
        { sku: "MFS-0041", quantidade: 0 },
        { sku: "MFS-0041", quantidade: 1 },
      ]),
    ).toEqual([]);
  });

  it("reconhece status cancelado normalizado", () => {
    expect(isStatusPedidoCancelado("cancelled")).toBe(true);
    expect(isStatusPedidoCancelado("UNKNOWN")).toBe(false);
  });
});
