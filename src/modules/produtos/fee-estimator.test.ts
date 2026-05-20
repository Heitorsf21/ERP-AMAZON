import { afterEach, describe, expect, it } from "vitest";
import {
  __test_utils__,
  calcularFeesLocal,
  findCommissionRule,
  invalidateFeeEstimateMemoryCache,
  type FeeEstimateConfig,
} from "@/modules/produtos/fee-estimator";

const cfgPromo: FeeEstimateConfig = {
  referralDefaultBps: 1200,
  fbaPromoAtiva: true,
  fbaPromoExpiraEm: new Date("2026-07-31T23:59:59.999-03:00"),
  fbaPromoUnder100Centavos: 500,
  fbaPromoOver100Centavos: 0,
  fbaFallbackPosPromoCentavos: 1005,
};

const cfgSemPromo: FeeEstimateConfig = {
  ...cfgPromo,
  fbaPromoAtiva: false,
};

const dentroDaJanela = new Date("2026-05-18T12:00:00-03:00");

afterEach(() => {
  invalidateFeeEstimateMemoryCache();
});

describe("fee-estimator: FBA promo (qty=1)", () => {
  it("aplica FBA R$5 para produto ≤ R$99.99 com promo ativa", () => {
    const r = calcularFeesLocal(6000, 1, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(500);
    expect(r.comissaoCentavos).toBe(720); // 12% de R$60
    expect(r.closingFeeCentavos).toBe(0);
  });

  it("aplica FBA R$5 no limite R$99.99", () => {
    const r = calcularFeesLocal(9999, 1, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(500);
  });

  it("aplica FBA R$0 para produto ≥ R$100 com promo ativa", () => {
    const r = calcularFeesLocal(12000, 1, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(0);
    expect(r.comissaoCentavos).toBe(1440); // 12% de R$120
  });

  it("aplica fallback pós-promo (R$10.05) quando promo desligada", () => {
    const r = calcularFeesLocal(6000, 1, cfgSemPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(1005);
  });

  it("aplica fallback pós-promo quando data passou de expira_em", () => {
    const depoisDoFim = new Date("2026-08-01T12:00:00-03:00");
    const r = calcularFeesLocal(6000, 1, cfgPromo, undefined, depoisDoFim);
    expect(r.fbaCentavos).toBe(1005);
  });
});

describe("fee-estimator: FBA por unidade (qty>1) — Amazon Brasil per-unit rule", () => {
  it("3 un × R$41,57 (unit < R$100) → 3 × R$5 = R$15", () => {
    // Caso real reportado pelo usuário (pedido 701-2310526-4297041).
    // Total da linha = R$124,71, mas cada unidade < R$100 → FBA cobra R$5/un.
    const r = calcularFeesLocal(12471, 3, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(1500); // R$5 × 3
  });

  it("3 un × R$120 (unit ≥ R$100) → 3 × R$0 = R$0 (isenção total)", () => {
    const r = calcularFeesLocal(36000, 3, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(0);
  });

  it("2 un × R$50 (unit < R$100, total > R$100) → 2 × R$5 (NÃO usa total na avaliação)", () => {
    // Antes do fix, esse caso retornaria R$0 (avaliava total > R$100).
    // Após o fix, avalia unit < R$100 → R$5/un × 2 = R$10.
    const r = calcularFeesLocal(10000, 2, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(1000);
  });

  it("comissão (% sobre bruto total) escala corretamente com qty", () => {
    const r = calcularFeesLocal(12471, 3, cfgPromo, undefined, dentroDaJanela);
    expect(r.comissaoCentavos).toBe(Math.round(12471 * 0.12)); // 1497
  });

  it("closingFee mídia × qty (Livros)", () => {
    const r = calcularFeesLocal(
      10000,
      4,
      cfgPromo,
      { categoriaSlug: "livros" },
      dentroDaJanela,
    );
    expect(r.closingFeeCentavos).toBe(199 * 4); // 796
  });

  it("quantidade < 1 cai pra 1 (defensivo)", () => {
    const r = calcularFeesLocal(6000, 0, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(500); // tratada como qty=1
  });
});

describe("fee-estimator: comissão", () => {
  it("usa override comissaoBps quando passado", () => {
    const r = calcularFeesLocal(
      6000,
      1,
      cfgPromo,
      { comissaoBps: 1500 },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(900); // 15% de R$60
  });

  it("zera valores negativos defensivamente", () => {
    const r = calcularFeesLocal(-100, 1, cfgPromo, undefined, dentroDaJanela);
    expect(r.comissaoCentavos).toBe(0);
    expect(r.fbaCentavos).toBe(500);
  });
});

describe("fee-estimator: tabela de categorias", () => {
  it("Cozinha → 12% sem closing fee", () => {
    const r = calcularFeesLocal(
      6000,
      1,
      cfgPromo,
      { categoriaSlug: "cozinha" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(720);
    expect(r.closingFeeCentavos).toBe(0);
    expect(r.categoriaLabel).toBe("Cozinha");
  });

  it("Beleza → 13%", () => {
    const r = calcularFeesLocal(
      6000,
      1,
      cfgPromo,
      { categoriaSlug: "beleza" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(780); // 13% de R$60
  });

  it("Livros → 15% + closing fee R$1.99", () => {
    const r = calcularFeesLocal(
      5000,
      1,
      cfgPromo,
      { categoriaSlug: "livros" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(750);
    expect(r.closingFeeCentavos).toBe(199);
  });

  it("Móveis abaixo de R$200 → 15%", () => {
    const r = calcularFeesLocal(
      15000,
      1,
      cfgPromo,
      { categoriaSlug: "moveis" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(2250); // 15% de R$150
  });

  it("Móveis R$300 → 15% sobre R$200 + 10% sobre R$100", () => {
    const r = calcularFeesLocal(
      30000,
      1,
      cfgPromo,
      { categoriaSlug: "moveis" },
      dentroDaJanela,
    );
    // 15% × 20000 + 10% × 10000 = 3000 + 1000 = 4000
    expect(r.comissaoCentavos).toBe(4000);
  });

  it("Acessórios eletrônicos R$150 → tier (15% × 100 + 10% × 50)", () => {
    const r = calcularFeesLocal(
      15000,
      1,
      cfgPromo,
      { categoriaSlug: "acessorios-eletronicos-pc" },
      dentroDaJanela,
    );
    // 15% × 10000 + 10% × 5000 = 1500 + 500 = 2000
    expect(r.comissaoCentavos).toBe(2000);
  });

  it("Slug desconhecido → fallback default 12%", () => {
    const r = calcularFeesLocal(
      6000,
      1,
      cfgPromo,
      { categoriaSlug: "categoria-nao-existe" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(720);
    expect(r.categoriaLabel).toBeUndefined();
  });

  it("Comida → 10% com piso de R$1 (preço muito baixo)", () => {
    const r = calcularFeesLocal(
      500, // R$5 — 10% = R$0.50, abaixo do piso de R$1
      1,
      cfgPromo,
      { categoriaSlug: "comidas-bebidas" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(100); // piso R$1
  });

  it("Bebês → 12% com piso de R$2 (preço muito baixo)", () => {
    const r = calcularFeesLocal(
      500, // R$5 — 12% = R$0.60, abaixo do piso de R$2
      1,
      cfgPromo,
      { categoriaSlug: "bebes" },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(200); // piso R$2
  });
});

describe("fee-estimator: findCommissionRule", () => {
  it("encontra rule conhecida", () => {
    const r = findCommissionRule("cozinha");
    expect(r?.label).toBe("Cozinha");
    expect(r?.rateBps).toBe(1200);
  });

  it("retorna undefined para slug inexistente", () => {
    expect(findCommissionRule("xyz")).toBeUndefined();
  });

  it("retorna undefined para null/undefined", () => {
    expect(findCommissionRule(null)).toBeUndefined();
    expect(findCommissionRule(undefined)).toBeUndefined();
  });
});

describe("fee-estimator: tabela completa tem 36 categorias", () => {
  it("COMMISSION_TABLE deve ter exatamente as categorias da extensão", () => {
    expect(__test_utils__.COMMISSION_TABLE.length).toBe(36);
  });

  it("Todas com slug, rateBps e minCentavos definidos", () => {
    for (const rule of __test_utils__.COMMISSION_TABLE) {
      expect(rule.slug).toMatch(/^[a-z0-9-]+$/);
      expect(rule.rateBps).toBeGreaterThan(0);
      expect(rule.rateBps).toBeLessThanOrEqual(2000);
      expect(rule.minCentavos).toBeGreaterThanOrEqual(100);
    }
  });
});
