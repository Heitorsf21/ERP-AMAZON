import { describe, expect, it } from "vitest";
import {
  calcularDeltasKpis,
  consolidarKpis,
  consolidarTimeline,
  consolidarTopProdutos,
  type KpisDashboard,
  type TimelineDashboard,
  type TopProdutoDashboard,
} from "./consolidado";

const MFS = { empresaId: "mundofs", nome: "MundoFS" };
const UDN = { empresaId: "udn", nome: "UDN" };

function kpis(over: Partial<KpisDashboard> = {}): KpisDashboard {
  return {
    periodo: { de: new Date("2026-09-08T03:00:00Z"), ate: new Date("2026-10-08T02:59:59Z") },
    faturamentoCentavos: 0,
    freteCentavos: 0,
    faturamentoComFreteCentavos: 0,
    faturamentoReembolsadoCentavos: 0,
    faturamentoComReembolsadosCentavos: 0,
    liquidoMarketplaceCentavos: 0,
    impostoSimplesCentavos: 0,
    impostoSimplesAliquotaBps: 600,
    impostoSimplesAtivo: true,
    lucroBrutoCentavos: 0,
    margemPercentual: null,
    numeroVendas: 0,
    unidades: 0,
    ticketMedioCentavos: 0,
    roiPercentual: null,
    valorAdsCentavos: 0,
    tacosPercentual: null,
    lucroPosAdsCentavos: 0,
    mpaPercentual: null,
    contasFixasCentavos: 0,
    mpaPosContasFixasPercentual: null,
    roiPosAdsPercentual: null,
    trafficSessions: 0,
    trafficPageViews: 0,
    trafficUnitsOrdered: 0,
    trafficRevenueOrderedCentavos: 0,
    trafficConversionPercent: null,
    trafficBuyBoxPercent: null,
    valorAdsFonte: "VAZIO",
    valorAdsParcial: false,
    custoTotalCentavos: 0,
    vendasSemCusto: 0,
    vendasComTaxaEstimada: 0,
    categoriasTaxaEstimada: [],
    origemTaxas: "nenhuma",
    ...over,
  };
}

// Números reais de 30 dias (protótipo v2).
const kMfs = kpis({
  faturamentoCentavos: 3_217_226,
  liquidoMarketplaceCentavos: 2_500_000,
  lucroBrutoCentavos: 458_150,
  numeroVendas: 420,
  unidades: 480,
  custoTotalCentavos: 1_870_000,
  valorAdsCentavos: 98_992,
  lucroPosAdsCentavos: 359_158,
  contasFixasCentavos: 50_000,
  trafficSessions: 3000,
  trafficUnitsOrdered: 300,
  trafficBuyBoxPercent: 90,
  valorAdsFonte: "SYNC",
  origemTaxas: "real",
  impostoSimplesAliquotaBps: 600,
});
const kUdn = kpis({
  faturamentoCentavos: 768_544,
  liquidoMarketplaceCentavos: 600_000,
  lucroBrutoCentavos: 119_631,
  numeroVendas: 122,
  unidades: 136,
  custoTotalCentavos: 427_000,
  valorAdsCentavos: 0,
  lucroPosAdsCentavos: 119_631,
  trafficSessions: 1000,
  trafficUnitsOrdered: 100,
  trafficBuyBoxPercent: 50,
  valorAdsFonte: "VAZIO",
  origemTaxas: "nenhuma",
  impostoSimplesAliquotaBps: 400,
});

describe("consolidarKpis", () => {
  const r = consolidarKpis(
    [
      { loja: MFS, kpis: kMfs },
      { loja: UDN, kpis: kUdn },
    ],
    "mundofs",
  );

  it("soma os valores aditivos", () => {
    expect(r.faturamentoCentavos).toBe(3_985_770);
    expect(r.lucroBrutoCentavos).toBe(577_781);
    expect(r.numeroVendas).toBe(542);
    expect(r.unidades).toBe(616);
    expect(r.valorAdsCentavos).toBe(98_992);
    expect(r.lucroPosAdsCentavos).toBe(478_789);
    expect(r.contasFixasCentavos).toBe(50_000);
    expect(r.trafficSessions).toBe(4000);
  });

  it("recalcula os percentuais sobre as somas, não pela média", () => {
    expect(r.margemPercentual).toBeCloseTo((577_781 / 3_985_770) * 100, 6);
    expect(r.mpaPercentual).toBeCloseTo((478_789 / 3_985_770) * 100, 6);
    expect(r.roiPercentual).toBeCloseTo((577_781 / 2_297_000) * 100, 6);
    expect(r.tacosPercentual).toBeCloseTo((98_992 / 3_985_770) * 100, 6);
    expect(r.ticketMedioCentavos).toBe(Math.round(3_985_770 / 542));
    expect(r.mpaPosContasFixasPercentual).toBeCloseTo(((478_789 - 50_000) / 3_985_770) * 100, 6);
    expect(r.trafficConversionPercent).toBeCloseTo(10, 6);
  });

  it("buy box ponderada pelas sessões", () => {
    expect(r.trafficBuyBoxPercent).toBeCloseTo((90 * 3000 + 50 * 1000) / 4000, 6);
  });

  it("imposto é o da loja aberta; fonte de ads é a da loja com maior gasto", () => {
    expect(r.impostoSimplesAliquotaBps).toBe(600);
    expect(r.valorAdsFonte).toBe("SYNC");
  });

  it("origem das taxas: real + nenhuma = real", () => {
    expect(r.origemTaxas).toBe("real");
  });

  it("por loja: participação e números de cada uma, na ordem das lojas", () => {
    expect(r.porLoja.map((l) => l.nome)).toEqual(["MundoFS", "UDN"]);
    expect(r.porLoja[0]?.participacaoPercentual).toBeCloseTo(80.72, 1);
    expect(r.porLoja[1]?.participacaoPercentual).toBeCloseTo(19.28, 1);
    expect(r.porLoja[0]?.atual).toBe(true);
    expect(r.porLoja[1]?.atual).toBe(false);
    expect(r.porLoja[1]?.numeroVendas).toBe(122);
    expect(r.porLoja[1]?.margemPercentual).toBe(kUdn.margemPercentual);
  });

  it("custo incompleto em uma loja deixa lucro, margem e ROI do total em N/A", () => {
    const x = consolidarKpis(
      [
        { loja: MFS, kpis: kMfs },
        { loja: UDN, kpis: { ...kUdn, lucroBrutoCentavos: null, lucroPosAdsCentavos: null, custoTotalCentavos: null } },
      ],
      "mundofs",
    );
    expect(x.lucroBrutoCentavos).toBeNull();
    expect(x.margemPercentual).toBeNull();
    expect(x.roiPercentual).toBeNull();
    expect(x.lucroPosAdsCentavos).toBeNull();
    expect(x.mpaPercentual).toBeNull();
    expect(x.custoTotalCentavos).toBeNull();
  });

  it("período sem venda: participação nula e percentuais nulos", () => {
    const x = consolidarKpis(
      [
        { loja: MFS, kpis: kpis() },
        { loja: UDN, kpis: kpis() },
      ],
      "mundofs",
    );
    expect(x.porLoja[0]?.participacaoPercentual).toBeNull();
    expect(x.margemPercentual).toBeNull();
    expect(x.ticketMedioCentavos).toBe(0);
  });

  it("uma loja sem venda fica com 0% e a outra com 100%", () => {
    const x = consolidarKpis(
      [
        { loja: MFS, kpis: kMfs },
        { loja: UDN, kpis: kpis() },
      ],
      "mundofs",
    );
    expect(x.porLoja[0]?.participacaoPercentual).toBe(100);
    expect(x.porLoja[1]?.participacaoPercentual).toBe(0);
  });

  it("origem: real + estimado = misto; categorias estimadas somadas por slug", () => {
    const x = consolidarKpis(
      [
        {
          loja: MFS,
          kpis: kpis({
            origemTaxas: "real",
            categoriasTaxaEstimada: [{ slug: "casa", label: "Casa", regra: "12%", vendas: 2 }],
          }),
        },
        {
          loja: UDN,
          kpis: kpis({
            origemTaxas: "estimado",
            categoriasTaxaEstimada: [
              { slug: "casa", label: "Casa", regra: "12%", vendas: 1 },
              { slug: null, label: "Default global", regra: "12%", vendas: 4 },
            ],
          }),
        },
      ],
      "mundofs",
    );
    expect(x.origemTaxas).toBe("misto");
    expect(x.categoriasTaxaEstimada).toEqual([
      { slug: null, label: "Default global", regra: "12%", vendas: 4 },
      { slug: "casa", label: "Casa", regra: "12%", vendas: 3 },
    ]);
  });
});

describe("calcularDeltasKpis", () => {
  it("variação em % para valores e em p.p. para percentuais", () => {
    const d = calcularDeltasKpis(
      kpis({ faturamentoCentavos: 120, margemPercentual: 14.5 }),
      kpis({ faturamentoCentavos: 100, margemPercentual: 16.2 }),
    );
    expect(d.faturamento).toBeCloseTo(20, 6);
    expect(d.margem).toBeCloseTo(-1.7, 6);
  });

  it("anterior zero ou nulo dá null", () => {
    const d = calcularDeltasKpis(kpis({ faturamentoCentavos: 100 }), kpis());
    expect(d.faturamento).toBeNull();
    expect(d.margem).toBeNull();
  });
});

describe("consolidarTimeline", () => {
  const dia = (data: string, fat: number, lucro: number | null): TimelineDashboard => ({
    data,
    faturamentoCentavos: fat,
    liquidoMarketplaceCentavos: fat - 10,
    impostoSimplesCentavos: 1,
    lucroBrutoCentavos: lucro,
    lucroPosAdsCentavos: lucro == null ? null : lucro - 1,
  });

  it("soma dia a dia; lucro nulo em uma loja deixa o dia nulo", () => {
    const r = consolidarTimeline([
      [dia("2026-10-01", 100, 20), dia("2026-10-02", 50, 5)],
      [dia("2026-10-01", 30, 4), dia("2026-10-02", 10, null)],
    ]);
    expect(r).toEqual([
      {
        data: "2026-10-01",
        faturamentoCentavos: 130,
        liquidoMarketplaceCentavos: 110,
        impostoSimplesCentavos: 2,
        lucroBrutoCentavos: 24,
        lucroPosAdsCentavos: 22,
      },
      {
        data: "2026-10-02",
        faturamentoCentavos: 60,
        liquidoMarketplaceCentavos: 40,
        impostoSimplesCentavos: 2,
        lucroBrutoCentavos: null,
        lucroPosAdsCentavos: null,
      },
    ]);
  });
});

describe("consolidarTopProdutos", () => {
  const prod = (sku: string, fat: number, over: Partial<TopProdutoDashboard> = {}): TopProdutoDashboard => ({
    sku,
    produtoId: `p-${sku}`,
    nome: sku,
    imagemUrl: "/uploads/x.png",
    amazonImagemUrl: "https://m.media-amazon.com/x.jpg",
    asin: "B0X",
    precoMedioCentavos: 1000,
    custoUnitarioCentavos: 500,
    unidades: 1,
    faturadoCentavos: fat,
    representatividadePercentual: 50,
    lucroCentavos: 100,
    impostoSimplesCentavos: 0,
    margemPercentual: 10,
    custoAdsCentavos: 0,
    lucroPosAdsCentavos: 100,
    mpaPercentual: 10,
    ...over,
  });

  const r = consolidarTopProdutos(
    [
      { loja: MFS, produtos: [prod("MFS-1", 400), prod("KIT", 300)], totalFaturamentoCentavos: 800 },
      { loja: UDN, produtos: [prod("KIT", 350), prod("UDN-9", 100)], totalFaturamentoCentavos: 200 },
    ],
    3,
    "mundofs",
  );

  it("ordena a união por faturado e corta no limite", () => {
    expect(r.map((p) => `${p.loja.nome}:${p.sku}`)).toEqual(["MundoFS:MFS-1", "UDN:KIT", "MundoFS:KIT"]);
  });

  it("SKU igual em lojas diferentes não se funde", () => {
    expect(r.filter((p) => p.sku === "KIT")).toHaveLength(2);
  });

  it("representatividade sobre o faturamento somado das lojas", () => {
    expect(r[0]?.representatividadePercentual).toBeCloseTo(40, 6);
    expect(r[1]?.representatividadePercentual).toBeCloseTo(35, 6);
  });

  it("marca a loja de cada item e tira a foto local dos itens de outra loja", () => {
    expect(r[0]?.loja).toEqual({ empresaId: "mundofs", nome: "MundoFS", atual: true });
    expect(r[0]?.imagemUrl).toBe("/uploads/x.png");
    expect(r[1]?.loja.atual).toBe(false);
    expect(r[1]?.imagemUrl).toBeNull();
    expect(r[1]?.amazonImagemUrl).toBe("https://m.media-amazon.com/x.jpg");
  });

  it("total zero deixa a representatividade nula", () => {
    const x = consolidarTopProdutos(
      [{ loja: MFS, produtos: [prod("A", 0)], totalFaturamentoCentavos: 0 }],
      15,
      "mundofs",
    );
    expect(x[0]?.representatividadePercentual).toBeNull();
  });
});
