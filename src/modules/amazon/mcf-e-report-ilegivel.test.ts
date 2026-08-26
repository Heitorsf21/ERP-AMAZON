import { describe, expect, it } from "vitest";
import { isReportIlegivelPermanente } from "@/modules/amazon/report-runner";
import { isPedidoMultiChannelFulfillment } from "@/modules/vendas/filtros";

describe("isPedidoMultiChannelFulfillment", () => {
  it("reconhece o pedido MCF do print (prefixo S01-)", () => {
    expect(
      isPedidoMultiChannelFulfillment({
        amazonOrderId: "S01-9906177-4378743",
      }),
    ).toBe(true);
  });

  it("reconhece pelo canal Non-Amazon mesmo sem o prefixo", () => {
    expect(
      isPedidoMultiChannelFulfillment({
        amazonOrderId: "701-1234567-1234567",
        marketplace: "Non-Amazon",
      }),
    ).toBe(true);
  });

  it("nao marca pedido normal do marketplace", () => {
    expect(
      isPedidoMultiChannelFulfillment({
        amazonOrderId: "702-8894080-9431418",
        marketplace: "Amazon.com.br",
      }),
    ).toBe(false);
  });
});

describe("isReportIlegivelPermanente", () => {
  it("trata 403 do report pendente como permanente", () => {
    const erro = new Error(
      'SP-API GET /reports/2021-06-30/reports/54120020648 -> 403: { "errors": [ { "code": "Unauthorized" } ] }',
    );
    expect(isReportIlegivelPermanente(erro)).toBe(true);
  });

  it("trata 404 como permanente", () => {
    expect(
      isReportIlegivelPermanente(new Error("SP-API GET /reports/x -> 404: {}")),
    ).toBe(true);
  });

  it("NAO trata 429 como permanente (quota e transitoria)", () => {
    expect(
      isReportIlegivelPermanente(new Error("SP-API GET /reports/x -> 429: {}")),
    ).toBe(false);
  });

  it("NAO trata 503 como permanente", () => {
    expect(
      isReportIlegivelPermanente(new Error("SP-API GET /reports/x -> 503: {}")),
    ).toBe(false);
  });

  it("NAO trata erro sem status HTTP como permanente", () => {
    expect(isReportIlegivelPermanente(new Error("fetch failed"))).toBe(false);
  });
});
