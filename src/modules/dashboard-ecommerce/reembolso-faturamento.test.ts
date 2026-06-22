import { describe, expect, it } from "vitest";
import {
  chaveVendaReembolso,
  separarVendasReembolsadas,
} from "./reembolso-faturamento";

type VendaTeste = {
  amazonOrderId: string;
  sku: string;
  statusPedido?: string | null;
  statusFinanceiro?: string | null;
  valorBrutoCentavos: number;
};

const venda = (over: Partial<VendaTeste> = {}): VendaTeste => ({
  amazonOrderId: "701-1",
  sku: "SKU-1",
  statusPedido: "Shipped",
  statusFinanceiro: "RELEASED",
  valorBrutoCentavos: 8197,
  ...over,
});

describe("separarVendasReembolsadas", () => {
  it("mantem no faturamento a venda sem reembolso na janela", () => {
    const base = [venda()];
    const { faturaveis, reembolsadas } = separarVendasReembolsadas(
      base,
      new Set(),
    );
    expect(faturaveis).toHaveLength(1);
    expect(reembolsadas).toHaveLength(0);
  });

  it("remove do faturamento a venda com reembolso TOTAL (marcada REEMBOLSADO)", () => {
    const total = venda({
      statusPedido: "REEMBOLSADO",
      statusFinanceiro: "REEMBOLSADO",
    });
    const keys = new Set([chaveVendaReembolso(total)]);
    const { faturaveis, reembolsadas } = separarVendasReembolsadas([total], keys);
    expect(faturaveis).toHaveLength(0);
    expect(reembolsadas).toHaveLength(1);
  });

  it("MANTEM no faturamento a venda com reembolso PARCIAL (nao marcada) — regressao do bug", () => {
    // O reembolso parcial (ex.: so frete) cria AmazonReembolso na janela, mas a
    // venda NAO e marcada REEMBOLSADO. Nao pode zerar a venda inteira.
    const parcial = venda({ statusPedido: "Shipped", statusFinanceiro: "RELEASED" });
    const keys = new Set([chaveVendaReembolso(parcial)]);
    const { faturaveis, reembolsadas } = separarVendasReembolsadas([parcial], keys);
    expect(faturaveis).toHaveLength(1);
    expect(reembolsadas).toHaveLength(0);
  });

  it("reconhece reembolso total tambem por statusFinanceiro isolado", () => {
    const totalPorFinanceiro = venda({
      statusPedido: "Shipped",
      statusFinanceiro: "REEMBOLSADO",
    });
    const keys = new Set([chaveVendaReembolso(totalPorFinanceiro)]);
    const { reembolsadas } = separarVendasReembolsadas([totalPorFinanceiro], keys);
    expect(reembolsadas).toHaveLength(1);
  });

  it("separa um lote misto corretamente", () => {
    const semReembolso = venda({ amazonOrderId: "701-A", sku: "S-A" });
    const total = venda({
      amazonOrderId: "701-B",
      sku: "S-B",
      statusFinanceiro: "REEMBOLSADO",
    });
    const parcial = venda({ amazonOrderId: "701-C", sku: "S-C" });
    const keys = new Set([
      chaveVendaReembolso(total),
      chaveVendaReembolso(parcial),
    ]);
    const { faturaveis, reembolsadas } = separarVendasReembolsadas(
      [semReembolso, total, parcial],
      keys,
    );
    expect(faturaveis.map((v) => v.amazonOrderId).sort()).toEqual([
      "701-A",
      "701-C",
    ]);
    expect(reembolsadas.map((v) => v.amazonOrderId)).toEqual(["701-B"]);
  });
});
