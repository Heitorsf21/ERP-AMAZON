import { describe, expect, it } from "vitest";
import {
  calcularFeesLocal,
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

describe("fee-estimator calcularFeesLocal", () => {
  const dentroDaJanela = new Date("2026-05-18T12:00:00-03:00");

  it("aplica FBA R$5 para produto ≤ R$99.99 com promo ativa", () => {
    const r = calcularFeesLocal(6000, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(500);
    expect(r.comissaoCentavos).toBe(720); // 12% de R$60
  });

  it("aplica FBA R$5 no limite R$99.99", () => {
    const r = calcularFeesLocal(9999, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(500);
  });

  it("aplica FBA R$0 para produto ≥ R$100 com promo ativa", () => {
    const r = calcularFeesLocal(12000, cfgPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(0);
    expect(r.comissaoCentavos).toBe(1440); // 12% de R$120
  });

  it("aplica fallback pós-promo (R$10.05) quando promo desligada", () => {
    const r = calcularFeesLocal(6000, cfgSemPromo, undefined, dentroDaJanela);
    expect(r.fbaCentavos).toBe(1005);
  });

  it("aplica fallback pós-promo quando data passou de expira_em", () => {
    const depoisDoFim = new Date("2026-08-01T12:00:00-03:00");
    const r = calcularFeesLocal(6000, cfgPromo, undefined, depoisDoFim);
    expect(r.fbaCentavos).toBe(1005);
  });

  it("usa override de comissão por SKU quando passado", () => {
    const r = calcularFeesLocal(
      6000,
      cfgPromo,
      { comissaoBps: 1500 },
      dentroDaJanela,
    );
    expect(r.comissaoCentavos).toBe(900); // 15% de R$60
  });

  it("zera valores negativos defensivamente", () => {
    const r = calcularFeesLocal(-100, cfgPromo, undefined, dentroDaJanela);
    expect(r.comissaoCentavos).toBe(0);
    expect(r.fbaCentavos).toBe(500); // ainda promo (0 ≤ 99.99)
  });
});
