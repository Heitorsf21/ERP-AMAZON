import { describe, expect, it } from "vitest";
import { formatBRL } from "@/lib/money";
import { formatarPercentual, montarKpisMobile, type KpisMobileEntrada } from "./kpis-mobile";

const base: KpisMobileEntrada = {
  faturamentoCentavos: 3_894_017,
  lucroBrutoCentavos: 529_626,
  margemPercentual: 13.6,
  numeroVendas: 431,
  roiPercentual: 21.4,
  valorAdsCentavos: 146_832,
  lucroPosAdsCentavos: 382_794,
  mpaPercentual: 9.83,
  delta: {
    faturamento: 12.4,
    lucroBruto: 8.1,
    margem: -0.6,
    numeroVendas: 9,
    roi: 1.8,
    valorAds: 4.2,
    lucroPosAds: -2,
  },
};

describe("KPIs do dashboard no celular", () => {
  it("mostra só os 6 escolhidos, nesta ordem", () => {
    const { cards } = montarKpisMobile(base);
    expect(cards.map((c) => c.rotulo)).toEqual([
      "Faturamento",
      "Lucro",
      "Margem",
      "Vendas",
      "ROI",
      "Gasto em anúncios",
    ]);
  });

  it("formata dinheiro, percentual e contagem", () => {
    const { cards, mpa } = montarKpisMobile(base);
    expect(cards[0]?.valor).toBe(formatBRL(3_894_017));
    expect(cards[2]?.valor).toBe("13,6%");
    expect(cards[3]?.valor).toBe("431");
    expect(mpa.valor).toBe("9,8%");
    expect(mpa.lucroPosAds).toBe(formatBRL(382_794));
  });

  it("a variação do bloco MPA é do Lucro pós-Ads, não do MPA (a API não tem delta de MPA)", () => {
    const { mpa } = montarKpisMobile(base);
    expect(mpa).not.toHaveProperty("delta");
    expect(mpa.deltaLucroPosAds).toEqual({ valor: base.delta.lucroPosAds, tipo: "percent" });
  });

  it("gasto em anúncios subir é ruim (delta inverso); margem e ROI são pp", () => {
    const { cards } = montarKpisMobile(base);
    expect(cards.find((c) => c.chave === "ads")?.delta).toEqual({
      valor: 4.2,
      tipo: "percent",
      inverso: true,
    });
    expect(cards.find((c) => c.chave === "margem")?.delta.tipo).toBe("pp");
    expect(cards.find((c) => c.chave === "roi")?.delta.tipo).toBe("pp");
  });

  it("sem custo cadastrado: lucro, margem, ROI e MPA viram N/A", () => {
    const { cards, mpa } = montarKpisMobile({
      ...base,
      lucroBrutoCentavos: null,
      margemPercentual: null,
      roiPercentual: null,
      lucroPosAdsCentavos: null,
      mpaPercentual: null,
    });
    expect(cards.find((c) => c.chave === "lucro")?.valor).toBe("N/A");
    expect(cards.find((c) => c.chave === "margem")?.valor).toBe("N/A");
    expect(cards.find((c) => c.chave === "roi")?.valor).toBe("N/A");
    expect(mpa.valor).toBe("N/A");
    expect(mpa.lucroPosAds).toBe("N/A");
  });

  it("formatarPercentual trata NaN e infinito", () => {
    expect(formatarPercentual(Number.NaN)).toBe("N/A");
    expect(formatarPercentual(Number.POSITIVE_INFINITY)).toBe("N/A");
    expect(formatarPercentual(undefined)).toBe("N/A");
  });
});
