/**
 * Estimador de taxas Amazon (Comissão + FBA).
 *
 * Quando usar:
 *   - VendaAmazon com statusFinanceiro = "PENDENTE" e taxasCentavos = 0
 *     (Amazon ainda não settled, então a Finance API não devolve fees).
 *
 * Quando NÃO usar:
 *   - VendaAmazon com taxasCentavos > 0 — esse é o valor REAL da Amazon,
 *     já inclui parcelamento (sub-breakdown AmazonForAllFee em AmazonFees).
 *
 * Parcelamento (1.5%) NÃO é estimado — só vem do real (API).
 *
 * Fontes:
 *   - Comissão default global: ConfiguracaoSistema.amazon_fee_referral_default_bps (12.00%)
 *   - Comissão por SKU (opcional): AmazonFeeEstimate.comissaoBps (preenchido por job
 *     AMAZON_FEE_ESTIMATE_SYNC via SP-API getMyFeesEstimateForSKU)
 *   - FBA com promo ativa: R$5 (≤R$99.99) ou R$0 (≥R$100). Janela: até 31/07/2026.
 *   - FBA pós-promo: ConfiguracaoSistema.amazon_fee_fba_fallback_pos_promo_centavos
 */
import { db } from "@/lib/db";

export type FeeEstimateConfig = {
  referralDefaultBps: number;
  fbaPromoAtiva: boolean;
  fbaPromoExpiraEm: Date | null;
  fbaPromoUnder100Centavos: number;
  fbaPromoOver100Centavos: number;
  fbaFallbackPosPromoCentavos: number;
};

export type FeeEstimateResult = {
  taxasCentavos: number;
  origem: "real" | "api" | "local";
  breakdown: {
    comissaoCentavos: number;
    fbaCentavos: number;
  };
};

const CFG_KEYS = {
  REFERRAL_DEFAULT_BPS: "amazon_fee_referral_default_bps",
  FBA_PROMO_ATIVA: "amazon_fee_fba_promo_ativa",
  FBA_PROMO_EXPIRA_EM: "amazon_fee_fba_promo_expira_em",
  FBA_PROMO_UNDER_100: "amazon_fee_fba_promo_under_100_centavos",
  FBA_PROMO_OVER_100: "amazon_fee_fba_promo_over_100_centavos",
  FBA_FALLBACK_POS_PROMO: "amazon_fee_fba_fallback_pos_promo_centavos",
} as const;

// Defaults usados quando ConfiguracaoSistema não tem a chave (ex: primeiro deploy
// antes do seed). Refletem a realidade Brasil 2026: comissão ~12%, promo FBA
// (≤R$99.99=R$5, ≥R$100=R$0) válida até 31/07/2026.
const DEFAULTS: FeeEstimateConfig = {
  referralDefaultBps: 1200,
  fbaPromoAtiva: true,
  fbaPromoExpiraEm: new Date("2026-07-31T23:59:59.999-03:00"),
  fbaPromoUnder100Centavos: 500,
  fbaPromoOver100Centavos: 0,
  fbaFallbackPosPromoCentavos: 1005,
};

const PROMO_LIMITE_CENTAVOS = 9999;

let cachedConfig: { value: FeeEstimateConfig; at: number } | null = null;
const CONFIG_CACHE_TTL_MS = 60_000;

export function invalidateFeeEstimatorConfigCache() {
  cachedConfig = null;
}

export async function loadFeeEstimatorConfig(
  now = Date.now(),
): Promise<FeeEstimateConfig> {
  if (cachedConfig && now - cachedConfig.at < CONFIG_CACHE_TTL_MS) {
    return cachedConfig.value;
  }
  const rows = await db.configuracaoSistema.findMany({
    where: { chave: { in: Object.values(CFG_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.chave, r.valor]));
  const parseInt10 = (raw: string | undefined, fallback: number) => {
    const n = raw != null ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const parseBool = (raw: string | undefined, fallback: boolean) =>
    raw == null ? fallback : raw.toLowerCase() === "true";
  const parseDate = (raw: string | undefined, fallback: Date | null) => {
    if (!raw) return fallback;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : fallback;
  };
  const value: FeeEstimateConfig = {
    referralDefaultBps: parseInt10(
      map.get(CFG_KEYS.REFERRAL_DEFAULT_BPS),
      DEFAULTS.referralDefaultBps,
    ),
    fbaPromoAtiva: parseBool(map.get(CFG_KEYS.FBA_PROMO_ATIVA), DEFAULTS.fbaPromoAtiva),
    fbaPromoExpiraEm: parseDate(
      map.get(CFG_KEYS.FBA_PROMO_EXPIRA_EM),
      DEFAULTS.fbaPromoExpiraEm,
    ),
    fbaPromoUnder100Centavos: parseInt10(
      map.get(CFG_KEYS.FBA_PROMO_UNDER_100),
      DEFAULTS.fbaPromoUnder100Centavos,
    ),
    fbaPromoOver100Centavos: parseInt10(
      map.get(CFG_KEYS.FBA_PROMO_OVER_100),
      DEFAULTS.fbaPromoOver100Centavos,
    ),
    fbaFallbackPosPromoCentavos: parseInt10(
      map.get(CFG_KEYS.FBA_FALLBACK_POS_PROMO),
      DEFAULTS.fbaFallbackPosPromoCentavos,
    ),
  };
  cachedConfig = { value, at: now };
  return value;
}

/**
 * Cálculo puro local (sem I/O). Recebe a config já carregada e devolve os valores.
 * Usado direto pelo estimator quando não há cache API ou nos testes.
 */
export function calcularFeesLocal(
  valorBrutoCentavos: number,
  cfg: FeeEstimateConfig,
  override?: { comissaoBps?: number },
  agora = new Date(),
): { comissaoCentavos: number; fbaCentavos: number } {
  const bruto = Math.max(0, Math.round(valorBrutoCentavos));
  const comissaoBps = override?.comissaoBps ?? cfg.referralDefaultBps;
  const comissaoCentavos = Math.round((bruto * comissaoBps) / 10000);
  const promoVigente =
    cfg.fbaPromoAtiva &&
    (cfg.fbaPromoExpiraEm == null || agora <= cfg.fbaPromoExpiraEm);
  let fbaCentavos: number;
  if (promoVigente) {
    fbaCentavos =
      bruto <= PROMO_LIMITE_CENTAVOS
        ? cfg.fbaPromoUnder100Centavos
        : cfg.fbaPromoOver100Centavos;
  } else {
    fbaCentavos = cfg.fbaFallbackPosPromoCentavos;
  }
  return { comissaoCentavos, fbaCentavos };
}

/**
 * Estima as taxas para UMA venda (1 unidade) ou linha (qty>1, multiplica FBA).
 * - Se taxasReaisCentavos > 0 → retorna esse valor com origem="real" (não recalcula).
 * - Senão tenta usar cache AmazonFeeEstimate (origem="api"); fallback local (origem="local").
 */
export async function estimarFeesVenda(input: {
  produtoId: string;
  valorBrutoCentavos: number;
  quantidade: number;
  taxasReaisCentavos: number;
  cfg?: FeeEstimateConfig;
  agora?: Date;
}): Promise<FeeEstimateResult> {
  if (input.taxasReaisCentavos > 0) {
    return {
      taxasCentavos: input.taxasReaisCentavos,
      origem: "real",
      breakdown: { comissaoCentavos: 0, fbaCentavos: 0 },
    };
  }

  const cfg = input.cfg ?? (await loadFeeEstimatorConfig());
  const agora = input.agora ?? new Date();
  const quantidade = Math.max(1, input.quantidade);

  const cache = await db.amazonFeeEstimate.findUnique({
    where: { produtoId: input.produtoId },
  });

  if (cache && cache.origem === "api") {
    const local = calcularFeesLocal(
      input.valorBrutoCentavos,
      cfg,
      { comissaoBps: cache.comissaoBps },
      agora,
    );
    // FBA do cache reflete uma estimativa API real para o ticket avaliado; reusamos
    // a comissão da API mas mantemos a regra de FBA local (promo é determinística).
    return {
      taxasCentavos: local.comissaoCentavos + local.fbaCentavos * quantidade,
      origem: "api",
      breakdown: {
        comissaoCentavos: local.comissaoCentavos,
        fbaCentavos: local.fbaCentavos * quantidade,
      },
    };
  }

  const local = calcularFeesLocal(input.valorBrutoCentavos, cfg, undefined, agora);
  return {
    taxasCentavos: local.comissaoCentavos + local.fbaCentavos * quantidade,
    origem: "local",
    breakdown: {
      comissaoCentavos: local.comissaoCentavos,
      fbaCentavos: local.fbaCentavos * quantidade,
    },
  };
}

export const __test_utils__ = {
  DEFAULTS,
  PROMO_LIMITE_CENTAVOS,
};
