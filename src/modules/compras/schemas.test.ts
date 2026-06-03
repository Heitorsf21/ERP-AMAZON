import { describe, expect, it } from "vitest";
import { criarPedidoCompraSchema } from "./schemas";

describe("criarPedidoCompraSchema — normalização de strings vazias", () => {
  const itensOk = [{ produtoId: "p1", quantidade: 1, custoUnitario: 100 }];

  it("converte fornecedorId/numero/dataPrevisao/observacoes vazios em undefined", () => {
    // Regressão: o form manda "" quando o usuário não escolhe fornecedor.
    // "" passava pelo `?? null` e quebrava a FK PedidoCompra_fornecedorId_fkey.
    const out = criarPedidoCompraSchema.parse({
      numero: "",
      fornecedorId: "",
      dataEmissao: "2026-06-03",
      dataPrevisao: "",
      observacoes: "  ",
      itens: itensOk,
    });
    expect(out.fornecedorId).toBeUndefined();
    expect(out.numero).toBeUndefined();
    expect(out.dataPrevisao).toBeUndefined();
    expect(out.observacoes).toBeUndefined();
  });

  it("preserva valores não vazios", () => {
    const out = criarPedidoCompraSchema.parse({
      fornecedorId: "forn-1",
      numero: "PO-2026-001",
      dataEmissao: "2026-06-03",
      itens: itensOk,
    });
    expect(out.fornecedorId).toBe("forn-1");
    expect(out.numero).toBe("PO-2026-001");
  });

  it("exige ao menos 1 item", () => {
    expect(() =>
      criarPedidoCompraSchema.parse({ dataEmissao: "2026-06-03", itens: [] }),
    ).toThrow();
  });
});
