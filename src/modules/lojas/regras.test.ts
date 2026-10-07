import { describe, expect, it } from "vitest";
import { corDaLoja, lojasComCor, ordenarLojas, ordenarPar, vinculoValido, type ContaVinculo } from "./regras";

const conta = (over: Partial<ContaVinculo> = {}): ContaVinculo => ({
  id: "u-a",
  ativo: true,
  sessionVersion: 0,
  empresaId: "mundofs",
  empresaAtiva: true,
  ...over,
});

describe("ordenarPar", () => {
  it("guarda o par sempre na mesma ordem, venha de qual lado vier", () => {
    expect(ordenarPar("u-b", "u-a")).toEqual({ usuarioAId: "u-a", usuarioBId: "u-b" });
    expect(ordenarPar("u-a", "u-b")).toEqual({ usuarioAId: "u-a", usuarioBId: "u-b" });
  });
});

describe("vinculoValido", () => {
  const a = conta({ id: "u-a", empresaId: "mundofs", sessionVersion: 2 });
  const b = conta({ id: "u-b", empresaId: "udn", sessionVersion: 5 });
  const v = { versaoA: 2, versaoB: 5 };

  it("vale com as duas contas e empresas ativas e as versões batendo", () => {
    expect(vinculoValido(v, a, b)).toBe(true);
  });

  it("cai quando uma conta é desativada", () => {
    expect(vinculoValido(v, { ...a, ativo: false }, b)).toBe(false);
    expect(vinculoValido(v, a, { ...b, ativo: false })).toBe(false);
  });

  it("cai quando uma empresa é desativada", () => {
    expect(vinculoValido(v, a, { ...b, empresaAtiva: false })).toBe(false);
  });

  it("cai quando as duas contas são da mesma empresa", () => {
    expect(vinculoValido(v, a, { ...b, empresaId: "mundofs" })).toBe(false);
  });

  it("cai quando qualquer lado trocou a senha ou encerrou as sessões", () => {
    expect(vinculoValido(v, { ...a, sessionVersion: 3 }, b)).toBe(false);
    expect(vinculoValido(v, a, { ...b, sessionVersion: 6 })).toBe(false);
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
      [{ empresaId: "mundofs", nome: "MundoFS", email: "m@x", papel: "ADMIN", vinculoId: "v1", vinculadaEm: "" }],
    );
    expect(r.map((l) => [l.nome, l.atual, l.cor.ponto])).toEqual([
      ["MundoFS", false, "bg-blue-500"],
      ["UDN", true, "bg-violet-500"],
    ]);
    expect(r[0]?.vinculoId).toBe("v1");
    expect(r[1]?.vinculoId).toBeNull();
  });
});
