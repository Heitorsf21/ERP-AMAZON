import { describe, expect, it } from "vitest";
import { contaValidaNoChaveiro, corDaLoja, destinoAoTrocar, iniciaisLoja, lojasComCor, ordenarLojas } from "./regras";

describe("contaValidaNoChaveiro", () => {
  const conta = { ativo: true, sessionVersion: 2, empresaAtiva: true };

  it("vale com conta e loja ativas e a mesma versão do vínculo", () => {
    expect(contaValidaNoChaveiro(conta, 2)).toBe(true);
  });

  it("cai com conta ou loja desativada", () => {
    expect(contaValidaNoChaveiro({ ...conta, ativo: false }, 2)).toBe(false);
    expect(contaValidaNoChaveiro({ ...conta, empresaAtiva: false }, 2)).toBe(false);
  });

  it("cai quando a conta trocou a senha ou encerrou as sessões depois do vínculo", () => {
    expect(contaValidaNoChaveiro(conta, 1)).toBe(false);
    expect(contaValidaNoChaveiro(conta, undefined)).toBe(false);
  });
});

describe("ordenarLojas", () => {
  it("ordena por nome em pt-BR, sem diferenciar maiúsculas", () => {
    const lojas = [{ nome: "UDN" }, { nome: "mundoFS" }, { nome: "Ávila" }];
    expect(ordenarLojas(lojas).map((l) => l.nome)).toEqual(["Ávila", "mundoFS", "UDN"]);
  });

  it("não altera a lista recebida", () => {
    const lojas = [{ nome: "UDN" }, { nome: "MundoFS" }];
    ordenarLojas(lojas);
    expect(lojas[0]?.nome).toBe("UDN");
  });
});

describe("corDaLoja", () => {
  it("1ª loja azul, 2ª violeta", () => {
    expect(corDaLoja(0).ponto).toBe("bg-blue-500");
    expect(corDaLoja(1).ponto).toBe("bg-violet-500");
    expect(corDaLoja(1).selo).toContain("text-violet-700");
  });

  it("cicla as cores com muitas lojas", () => {
    expect(() => corDaLoja(9)).not.toThrow();
    expect(corDaLoja(9).ponto).toMatch(/^bg-/);
  });
});

describe("lojasComCor", () => {
  it("junta a aberta e as vinculadas, ordena por nome e dá a cor pela posição", () => {
    const r = lojasComCor(
      { empresaId: "udn", nome: "UDN", email: "u@x", papel: "ADMIN" },
      [{ empresaId: "mundofs", nome: "MundoFS", email: "m@x", papel: "ADMIN", vinculoId: "v1" }],
    );
    expect(r.map((l) => [l.nome, l.atual, l.cor.ponto])).toEqual([
      ["MundoFS", false, "bg-blue-500"],
      ["UDN", true, "bg-violet-500"],
    ]);
    expect(r[0]?.vinculoId).toBe("v1");
    expect(r[1]?.vinculoId).toBeNull();
  });
});

describe("iniciaisLoja", () => {
  it("usa as maiúsculas do nome ou as iniciais das palavras", () => {
    expect(iniciaisLoja("MundoFS")).toBe("MF");
    expect(iniciaisLoja("UDN")).toBe("UD");
    expect(iniciaisLoja("Loja da Ana")).toBe("LD");
    expect(iniciaisLoja("mundofs")).toBe("MU");
    expect(iniciaisLoja("  ")).toBe("?");
  });
});

describe("destinoAoTrocar", () => {
  it("mantém a seção aberta, sem o item específico (que é da outra loja)", () => {
    expect(destinoAoTrocar("/vendas")).toBe("/vendas");
    expect(destinoAoTrocar("/produtos/ckabc123")).toBe("/produtos");
    expect(destinoAoTrocar("/publicidade/otimizador")).toBe("/publicidade");
  });

  it("raiz ou caminho vazio vai para o Início", () => {
    expect(destinoAoTrocar("/")).toBe("/dashboard-ecommerce");
    expect(destinoAoTrocar("")).toBe("/dashboard-ecommerce");
  });
});
