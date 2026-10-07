import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  ESPERA_PEDIDO_MS,
  INTERVALO_CONSULTA_PEDIDO_MS,
  estadoPedidoDestaque,
  intervaloConsultaPedido,
  loginParaAbrirPedido,
  normalizarLojaParam,
  normalizarPedidoParam,
  pedidoEhDeOutraLoja,
} from "./pedido-param";

describe("normalizarPedidoParam", () => {
  it("aceita o formato de pedido da Amazon (com espaços em volta)", () => {
    expect(normalizarPedidoParam("702-4417820-3391045")).toBe("702-4417820-3391045");
    expect(normalizarPedidoParam("  702-4417820-3391045 ")).toBe("702-4417820-3391045");
  });

  it("rejeita vazio, lixo e tentativa de injeção", () => {
    expect(normalizarPedidoParam(null)).toBeNull();
    expect(normalizarPedidoParam("")).toBeNull();
    expect(normalizarPedidoParam("702-441")).toBeNull();
    expect(normalizarPedidoParam("702-4417820-3391045' OR 1=1")).toBeNull();
  });
});

describe("normalizarLojaParam", () => {
  it("aceita id de empresa (cuid/slug) e rejeita lixo", () => {
    expect(normalizarLojaParam("cmb1x2y3z0000abcd")).toBe("cmb1x2y3z0000abcd");
    expect(normalizarLojaParam(" udn ")).toBe("udn");
    expect(normalizarLojaParam(null)).toBeNull();
    expect(normalizarLojaParam("")).toBeNull();
    expect(normalizarLojaParam("udn' OR 1=1")).toBeNull();
    expect(normalizarLojaParam("a".repeat(65))).toBeNull();
  });
});

describe("pedidoEhDeOutraLoja", () => {
  it("só quando o link traz a loja e ela difere da empresa da sessão", () => {
    expect(pedidoEhDeOutraLoja("udn", "mundofs")).toBe(true);
    expect(pedidoEhDeOutraLoja("udn", "udn")).toBe(false);
    expect(pedidoEhDeOutraLoja(null, "udn")).toBe(false);
    // Sessão antiga sem empresa: não dá para afirmar que é de outra loja.
    expect(pedidoEhDeOutraLoja("udn", null)).toBe(false);
  });
});

describe("loginParaAbrirPedido (Trocar de conta)", () => {
  it("depois de entrar na outra loja, o login volta para o pedido do aviso", () => {
    const url = loginParaAbrirPedido("702-4417820-3391045", "cmpy390qn0006vy7lhl9qkbzg");
    const next = new URL(url, "https://erp.mundofs.cloud").searchParams.get("next");
    expect(url.startsWith("/login?next=")).toBe(true);
    expect(next).toBe("/vendas?pedido=702-4417820-3391045&loja=cmpy390qn0006vy7lhl9qkbzg");
    // O formulário de login só aceita destinos seguros: este tem que passar.
    expect(safeNextPath(next)).toBe(next);
  });
});

describe("estadoPedidoDestaque (aviso de venda tocado logo após a compra)", () => {
  it("achou o pedido", () => {
    expect(estadoPedidoDestaque({ encontrados: 1, outraLoja: false, esperaEsgotada: false })).toBe(
      "encontrado",
    );
  });

  it("lista vazia logo após o aviso: aguarda a sincronização, não fala de outra loja", () => {
    expect(estadoPedidoDestaque({ encontrados: 0, outraLoja: false, esperaEsgotada: false })).toBe(
      "aguardando",
    );
  });

  it("depois da espera, aí sim não encontrado", () => {
    expect(estadoPedidoDestaque({ encontrados: 0, outraLoja: false, esperaEsgotada: true })).toBe(
      "nao_encontrado",
    );
  });

  it("link de outra loja: oferece trocar de conta sem esperar", () => {
    expect(estadoPedidoDestaque({ encontrados: 0, outraLoja: true, esperaEsgotada: false })).toBe(
      "outra_loja",
    );
  });

  it("só consulta de novo enquanto aguarda", () => {
    expect(intervaloConsultaPedido("aguardando")).toBe(INTERVALO_CONSULTA_PEDIDO_MS);
    expect(intervaloConsultaPedido("encontrado")).toBe(false);
    expect(intervaloConsultaPedido("nao_encontrado")).toBe(false);
    expect(intervaloConsultaPedido("outra_loja")).toBe(false);
    expect(INTERVALO_CONSULTA_PEDIDO_MS).toBe(15_000);
    expect(ESPERA_PEDIDO_MS).toBe(10 * 60_000);
  });
});
