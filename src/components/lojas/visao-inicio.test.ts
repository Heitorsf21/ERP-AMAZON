import { describe, expect, it } from "vitest";
import { gravarVisao, lerVisao } from "./visao-inicio";

function armazenamento(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    dados,
  };
}

const quebrado = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("visão do Início salva no aparelho", () => {
  it("sem nada salvo, abre na loja", () => {
    expect(lerVisao(armazenamento())).toBe("loja");
    expect(lerVisao(null)).toBe("loja");
  });

  it("lê 'todas' quando foi a última escolha", () => {
    expect(lerVisao(armazenamento({ "atlas:visao-inicio": "todas" }))).toBe("todas");
  });

  it("valor estranho vira 'loja'", () => {
    expect(lerVisao(armazenamento({ "atlas:visao-inicio": "outra" }))).toBe("loja");
  });

  it("grava a escolha", () => {
    const s = armazenamento();
    gravarVisao(s, "todas");
    expect(s.dados.get("atlas:visao-inicio")).toBe("todas");
  });

  it("navegador sem armazenamento (aba anônima) não quebra", () => {
    expect(lerVisao(quebrado)).toBe("loja");
    expect(() => gravarVisao(quebrado, "todas")).not.toThrow();
  });
});
