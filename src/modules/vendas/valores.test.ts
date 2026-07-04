import { describe, expect, it } from "vitest";
import { agruparLinhasVendaAmazon } from "@/modules/vendas/agrupamento";
import {
  calcularImpostoSimplesCentavos,
  calcularPrecoUnitarioCentavos,
  resolverPrecoVendaAmazon,
  valorBrutoDaVenda,
  valorBrutoFinanceiroPodeAtualizar,
} from "@/modules/vendas/valores";

describe("resolverPrecoVendaAmazon", () => {
  const itemBase = {
    quantidade: 1,
    valorBrutoCentavos: 0,
    taxasCentavos: 0,
    fretesCentavos: 0,
    liquidoMarketplaceCentavos: 0,
  };

  it("reposicao: forca R$0 e precoOrigem 'replacement', sem estimar via listing", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: true,
      item: itemBase,
      precoListagemCentavos: 4397, // mesmo com listing disponivel, NAO usa
    });
    expect(r).toEqual({
      valorBrutoCentavos: 0,
      precoOrigem: "replacement",
      taxasCentavos: 0,
      fretesCentavos: 0,
      liquidoMarketplaceCentavos: 0,
    });
  });

  it("venda que ja era reposicao permanece reposicao mesmo sem o sinal novo", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: { ...itemBase, valorBrutoCentavos: 4397 },
      existente: { precoOrigem: "replacement" },
    });
    expect(r.precoOrigem).toBe("replacement");
    expect(r.valorBrutoCentavos).toBe(0);
  });

  it("ItemPrice real (>0) vira 'sp-api'", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: {
        ...itemBase,
        valorBrutoCentavos: 6500,
        liquidoMarketplaceCentavos: 6500,
      },
    });
    expect(r.precoOrigem).toBe("sp-api");
    expect(r.valorBrutoCentavos).toBe(6500);
  });

  it("sem ItemPrice, usa fallback de listing (preco de listagem x qty)", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: { ...itemBase, quantidade: 2 },
      precoListagemCentavos: 4397,
    });
    expect(r.precoOrigem).toBe("listing");
    expect(r.valorBrutoCentavos).toBe(8794);
    expect(r.liquidoMarketplaceCentavos).toBe(8794);
  });

  it("sem ItemPrice, prefere o preco real recente do SKU sobre o listing (oferta ativa)", () => {
    // Cenario da almofada: listing cacheado R$78,97 mas oferta ativa vendendo
    // a R$67,97 — o preco real recente reflete a oferta, o listing nao.
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: itemBase,
      precoListagemCentavos: 7897,
      precoRealRecenteCentavos: 6797,
    });
    expect(r.precoOrigem).toBe("listing");
    expect(r.valorBrutoCentavos).toBe(6797);
    expect(r.liquidoMarketplaceCentavos).toBe(6797);
  });

  it("preco real recente multiplica pela quantidade, como o listing", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: { ...itemBase, quantidade: 2 },
      precoListagemCentavos: 7897,
      precoRealRecenteCentavos: 6797,
    });
    expect(r.valorBrutoCentavos).toBe(13594);
    expect(r.liquidoMarketplaceCentavos).toBe(13594);
  });

  it("sem preco real recente (null/0), cai no listing normalmente", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: itemBase,
      precoListagemCentavos: 7897,
      precoRealRecenteCentavos: 0,
    });
    expect(r.precoOrigem).toBe("listing");
    expect(r.valorBrutoCentavos).toBe(7897);
  });

  it("reposicao ignora o preco real recente (continua R$0)", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: true,
      item: itemBase,
      precoListagemCentavos: 7897,
      precoRealRecenteCentavos: 6797,
    });
    expect(r.precoOrigem).toBe("replacement");
    expect(r.valorBrutoCentavos).toBe(0);
  });

  it("ItemPrice real vence o preco real recente (nao e fallback)", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: {
        ...itemBase,
        valorBrutoCentavos: 6500,
        liquidoMarketplaceCentavos: 6500,
      },
      precoRealRecenteCentavos: 6797,
    });
    expect(r.precoOrigem).toBe("sp-api");
    expect(r.valorBrutoCentavos).toBe(6500);
  });

  it("nao regride 'sp-api' existente mesmo com preco real recente disponivel", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: itemBase,
      precoListagemCentavos: 7897,
      precoRealRecenteCentavos: 6797,
      existente: { precoOrigem: "sp-api", valorBrutoCentavos: 6500 },
    });
    expect(r.precoOrigem).toBe("sp-api");
    expect(r.valorBrutoCentavos).toBe(6500);
  });

  it("nunca regride 'sp-api' existente para 'listing'", () => {
    const r = resolverPrecoVendaAmazon({
      isReplacement: false,
      item: itemBase,
      precoListagemCentavos: 4397,
      existente: { precoOrigem: "sp-api", valorBrutoCentavos: 4287 },
    });
    expect(r.precoOrigem).toBe("sp-api");
    expect(r.valorBrutoCentavos).toBe(4287);
  });
});

describe("valores de VendaAmazon", () => {
  it("usa valor bruto salvo e calcula fallback por unidade vezes quantidade", () => {
    expect(
      valorBrutoDaVenda({
        quantidade: 2,
        precoUnitarioCentavos: 5000,
        valorBrutoCentavos: 11000,
      }),
    ).toBe(11000);

    expect(
      valorBrutoDaVenda({
        quantidade: 2,
        precoUnitarioCentavos: 5000,
        valorBrutoCentavos: null,
      }),
    ).toBe(10000);
  });

  it("calcula preco unitario a partir do total da linha", () => {
    expect(calcularPrecoUnitarioCentavos(10000, 2)).toBe(5000);
    expect(calcularPrecoUnitarioCentavos(9999, 3)).toBe(3333);
  });

  it("agrupa multiplas linhas do mesmo pedido e SKU sem perder quantidade", () => {
    const linhas = agruparLinhasVendaAmazon([
      {
        amazonOrderId: "701-1",
        sku: "SKU-1",
        quantidade: 1,
        valorBrutoCentavos: 5000,
        taxasCentavos: 600,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 4400,
      },
      {
        amazonOrderId: "701-1",
        sku: "SKU-1",
        quantidade: 1,
        valorBrutoCentavos: 5000,
        taxasCentavos: 600,
        fretesCentavos: 0,
        liquidoMarketplaceCentavos: 4400,
      },
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      quantidade: 2,
      valorBrutoCentavos: 10000,
      precoUnitarioCentavos: 5000,
      taxasCentavos: 1200,
      liquidoMarketplaceCentavos: 8800,
    });
  });

  it("mantem SKUs diferentes como linhas separadas no mesmo pedido", () => {
    const linhas = agruparLinhasVendaAmazon([
      {
        amazonOrderId: "701-2",
        sku: "SKU-A",
        quantidade: 1,
        valorBrutoCentavos: 3000,
      },
      {
        amazonOrderId: "701-2",
        sku: "SKU-B",
        quantidade: 1,
        valorBrutoCentavos: 7000,
      },
    ]);

    expect(linhas).toHaveLength(2);
    expect(linhas.reduce((sum, linha) => sum + linha.valorBrutoCentavos, 0)).toBe(
      10000,
    );
  });

  it("nao deixa o financeiro reduzir bruto valido em pedido com mais de uma unidade", () => {
    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: 10000,
        valorBrutoFinanceiroCentavos: 5000,
      }),
    ).toBe(false);

    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: 5000,
        valorBrutoFinanceiroCentavos: 5000,
      }),
    ).toBe(false);

    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: 5000,
        valorBrutoFinanceiroCentavos: 10000,
      }),
    ).toBe(true);

    expect(
      valorBrutoFinanceiroPodeAtualizar({
        quantidadeAtual: 2,
        valorBrutoAtualCentavos: null,
        valorBrutoFinanceiroCentavos: 10000,
      }),
    ).toBe(true);
  });
});

describe("calcularImpostoSimplesCentavos", () => {
  const base = {
    aliquotaBps: 600,
    ativo: true,
    statusPedido: "Shipped",
    statusFinanceiro: "Released",
  };

  it("aplica 6% sobre valor bruto com round half-away-from-zero", () => {
    expect(
      calcularImpostoSimplesCentavos({ ...base, valorBrutoCentavos: 7999 }),
    ).toBe(480);
    expect(
      calcularImpostoSimplesCentavos({ ...base, valorBrutoCentavos: 10000 }),
    ).toBe(600);
    expect(
      calcularImpostoSimplesCentavos({ ...base, valorBrutoCentavos: 12345 }),
    ).toBe(741);
  });

  it("retorna 0 quando o flag ativo esta falso", () => {
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        ativo: false,
        valorBrutoCentavos: 10000,
      }),
    ).toBe(0);
  });

  it("retorna 0 quando a aliquota e zero", () => {
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        aliquotaBps: 0,
        valorBrutoCentavos: 10000,
      }),
    ).toBe(0);
  });

  it("retorna 0 para valor bruto invalido ou nao positivo", () => {
    expect(
      calcularImpostoSimplesCentavos({ ...base, valorBrutoCentavos: 0 }),
    ).toBe(0);
    expect(
      calcularImpostoSimplesCentavos({ ...base, valorBrutoCentavos: -100 }),
    ).toBe(0);
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        valorBrutoCentavos: Number.NaN,
      }),
    ).toBe(0);
  });

  it("zera quando statusPedido indica reembolso (qualquer variante)", () => {
    const variantes = ["REEMBOLSADO", "Reembolsado", "Refunded", "REFUNDED"];
    for (const status of variantes) {
      expect(
        calcularImpostoSimplesCentavos({
          ...base,
          statusPedido: status,
          valorBrutoCentavos: 10000,
        }),
      ).toBe(0);
    }
  });

  it("zera quando statusFinanceiro indica reembolso", () => {
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        statusFinanceiro: "REEMBOLSADO",
        valorBrutoCentavos: 10000,
      }),
    ).toBe(0);
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        statusFinanceiro: "Refunded",
        valorBrutoCentavos: 10000,
      }),
    ).toBe(0);
  });

  it("respeita aliquota personalizada (4% Anexo II, 11.2% Anexo IV)", () => {
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        aliquotaBps: 400,
        valorBrutoCentavos: 10000,
      }),
    ).toBe(400);
    expect(
      calcularImpostoSimplesCentavos({
        ...base,
        aliquotaBps: 1120,
        valorBrutoCentavos: 10000,
      }),
    ).toBe(1120);
  });
});
