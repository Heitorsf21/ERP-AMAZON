import { describe, expect, it } from "vitest";
import { deveRecarregarAoVoltar } from "./refetch";

describe("deveRecarregarAoVoltar", () => {
  it("recarrega dashboard, vendas, detalhe de produto e contador do sino", () => {
    expect(deveRecarregarAoVoltar(["dashboard-ecommerce-kpis", {}])).toBe(true);
    expect(deveRecarregarAoVoltar(["dashboard-ecommerce-top-produtos", {}])).toBe(true);
    expect(deveRecarregarAoVoltar(["vendas", {}, 1, "principal"])).toBe(true);
    expect(deveRecarregarAoVoltar(["vendas-totais", {}])).toBe(true);
    expect(deveRecarregarAoVoltar(["produto-resumo-mobile", "p1"])).toBe(true);
    expect(deveRecarregarAoVoltar(["notificacoes-count"])).toBe(true);
  });

  it("não recarrega o resto (menu, config, auth)", () => {
    expect(deveRecarregarAoVoltar(["menu-preferencias"])).toBe(false);
    expect(deveRecarregarAoVoltar(["auth-me"])).toBe(false);
    expect(deveRecarregarAoVoltar([42])).toBe(false);
  });
});
