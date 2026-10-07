import { describe, expect, it } from "vitest";
import { deveRecarregarPorMensagem } from "./sessao-canal";

describe("aviso de troca de loja entre abas", () => {
  it("outra aba trocou de loja: esta recarrega", () => {
    expect(deveRecarregarPorMensagem({ tipo: "loja-trocada", empresaId: "udn", origem: "aba-1" }, "aba-2")).toBe(true);
  });

  it("a própria aba que trocou não recarrega (ela já está navegando para o destino)", () => {
    expect(deveRecarregarPorMensagem({ tipo: "loja-trocada", empresaId: "udn", origem: "aba-1" }, "aba-1")).toBe(false);
  });

  it("mensagem estranha é ignorada", () => {
    expect(deveRecarregarPorMensagem(null, "aba-1")).toBe(false);
    expect(deveRecarregarPorMensagem({ tipo: "outra" }, "aba-1")).toBe(false);
  });
});
