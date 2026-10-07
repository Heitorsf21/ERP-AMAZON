import { describe, expect, it } from "vitest";
import {
  chaveMenuUsuario,
  contarVisiveis,
  ehFixo,
  filtrarGruposVisiveis,
  liberadoParaQualquerPapel,
  ocultasDaSugestao,
  parseOcultas,
  sanitizarOcultas,
} from "./preferencias";

const HREFS = [
  "/home",
  "/agenda",
  "/caixa",
  "/dashboard-ecommerce",
  "/produtos",
  "/vendas",
  "/perfil",
  "/configuracoes",
];

describe("menu personalizável por usuário", () => {
  it("chave da preferência é escopada pelo usuário", () => {
    expect(chaveMenuUsuario("u1")).toBe("menu_abas_ocultas:u:u1");
  });

  it("as 4 abas do núcleo são fixas", () => {
    expect(ehFixo("/dashboard-ecommerce")).toBe(true);
    expect(ehFixo("/vendas")).toBe(true);
    expect(ehFixo("/produtos")).toBe(true);
    expect(ehFixo("/configuracoes")).toBe(true);
    expect(ehFixo("/agenda")).toBe(false);
  });

  it("parse tolera vazio, lixo e tipos errados", () => {
    expect(parseOcultas(null)).toEqual([]);
    expect(parseOcultas("")).toEqual([]);
    expect(parseOcultas("nao-json")).toEqual([]);
    expect(parseOcultas('{"a":1}')).toEqual([]);
    expect(parseOcultas('["/caixa", 3, null]')).toEqual(["/caixa"]);
  });

  it("sanitiza: descarta desconhecidos, fixos e repetidos, na ordem do menu", () => {
    expect(
      sanitizarOcultas(["/vendas", "/caixa", "/xpto", "/agenda", "/caixa"], HREFS),
    ).toEqual(["/agenda", "/caixa"]);
  });

  it("PUT forjado não esconde aba fixa", () => {
    expect(
      sanitizarOcultas(
        ["/dashboard-ecommerce", "/vendas", "/produtos", "/configuracoes"],
        HREFS,
      ),
    ).toEqual([]);
  });

  it("sugestão esconde tudo que não é fixo", () => {
    expect(ocultasDaSugestao(HREFS)).toEqual(["/home", "/agenda", "/caixa", "/perfil"]);
  });

  it("filtra itens ocultos e remove grupo que ficou vazio", () => {
    const grupos = [
      { id: "fin", items: [{ href: "/agenda" }, { href: "/caixa" }] },
      { id: "eco", items: [{ href: "/dashboard-ecommerce" }, { href: "/vendas" }] },
    ];
    const r = filtrarGruposVisiveis(grupos, ["/agenda", "/caixa", "/vendas"]);
    expect(r.map((g) => g.id)).toEqual(["eco"]);
    // /vendas é fixa: continua mesmo pedida como oculta
    expect(r[0]?.items.map((i) => i.href)).toEqual(["/dashboard-ecommerce", "/vendas"]);
  });

  it("conta abas visíveis ignorando ocultas inválidas", () => {
    expect(contarVisiveis(HREFS, ["/agenda", "/vendas"])).toBe(7);
  });
});

describe("liberadoParaQualquerPapel (menu é preferência pessoal)", () => {
  it("libera ler e gravar a própria preferência de menu, inclusive para LEITURA", () => {
    expect(liberadoParaQualquerPapel("/api/menu/preferencias", "GET")).toBe(true);
    expect(liberadoParaQualquerPapel("/api/menu/preferencias", "PUT")).toBe(true);
  });

  it("não libera outros métodos nem subcaminhos da API de menu", () => {
    expect(liberadoParaQualquerPapel("/api/menu/preferencias", "DELETE")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/menu/preferencias/x", "PUT")).toBe(false);
  });

  it("libera abrir a página Configurações (abas de admin ficam escondidas no cliente)", () => {
    expect(liberadoParaQualquerPapel("/configuracoes", "GET")).toBe(true);
    expect(liberadoParaQualquerPapel("/configuracoes", "HEAD")).toBe(true);
  });

  it("mantém restritas as APIs e subpáginas de Configurações", () => {
    expect(liberadoParaQualquerPapel("/configuracoes", "POST")).toBe(false);
    expect(liberadoParaQualquerPapel("/configuracoes/outra", "GET")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/configuracoes", "GET")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/configuracoes/whatsapp-estoque", "GET")).toBe(false);
  });

  it("libera o aviso de venda no próprio aparelho (rotas pessoais de push)", () => {
    expect(liberadoParaQualquerPapel("/api/push/config", "GET")).toBe(true);
    for (const m of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(liberadoParaQualquerPapel("/api/push/dispositivos", m)).toBe(true);
    }
    expect(liberadoParaQualquerPapel("/api/push/teste", "POST")).toBe(true);
  });

  it("libera as lojas da própria conta (vincular, trocar, desvincular) para qualquer papel", () => {
    expect(liberadoParaQualquerPapel("/api/lojas", "GET")).toBe(true);
    expect(liberadoParaQualquerPapel("/api/lojas/vincular", "POST")).toBe(true);
    expect(liberadoParaQualquerPapel("/api/lojas/vincular/2fa", "POST")).toBe(true);
    expect(liberadoParaQualquerPapel("/api/lojas/vinculos/ckv123", "DELETE")).toBe(true);
    expect(liberadoParaQualquerPapel("/api/auth/trocar-loja", "POST")).toBe(true);
  });

  it("não libera métodos ou caminhos fora do combinado nas lojas", () => {
    expect(liberadoParaQualquerPapel("/api/lojas", "POST")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/lojas/vinculos/ckv123", "GET")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/lojas/vinculos/a/b", "DELETE")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/auth/trocar-loja", "GET")).toBe(false);
  });

  it("não libera métodos nem subcaminhos fora das rotas de push", () => {
    expect(liberadoParaQualquerPapel("/api/push/config", "POST")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/push/teste", "GET")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/push/dispositivos/x", "DELETE")).toBe(false);
    expect(liberadoParaQualquerPapel("/api/push", "GET")).toBe(false);
  });
});
