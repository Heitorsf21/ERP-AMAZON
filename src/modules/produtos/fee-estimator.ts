/**
 * Estimador de taxas Amazon (Comissão + FBA + Closing fee mídia).
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
 *   - Tabela de comissão por categoria (36 entradas, BR 2026) replicada da
 *     extensão de análise Amazon — fonte: sell.amazon.com.br/precos.
 *   - Comissão default global (categoria desconhecida): 12% empirico
 *     (calibrado pelas planilhas Gestor Seller Out/2025-Abr/2026 do user).
 *   - FBA promo: R$5 (≤R$99.99) / R$0 (≥R$100). Janela: até 31/07/2026.
 *   - FBA pós-promo: ConfiguracaoSistema.amazon_fee_fba_fallback_pos_promo_centavos.
 *   - Closing fee mídia (Livros/DVD/Música/Games): R$1.99.
 *
 * Caches em camadas:
 *   1. Memory Map (chave produtoId:bruto:qtd, TTL 5min) — O(1).
 *   2. Postgres AmazonFeeEstimate (populado por AMAZON_FEE_ESTIMATE_SYNC) — ~10ms.
 *   3. Fallback local puro (CPU only).
 */
import { db } from "@/lib/db";
import {
  COMMISSION_TABLE,
  calcularComissaoCentavos,
  findCommissionRule,
} from "@/modules/produtos/commission-table";
export { findCommissionRule, listCommissionCategories } from "@/modules/produtos/commission-table";

export const RULE_VERSION_LOCAL = "local-v2-2026-05";

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
  ruleVersion: string;
  breakdown: {
    comissaoCentavos: number;
    fbaCentavos: number;
    closingFeeCentavos: number;
  };
  categoriaLabel?: string;
};

const CFG_KEYS = {
  REFERRAL_DEFAULT_BPS: "amazon_fee_referral_default_bps",
  FBA_PROMO_ATIVA: "amazon_fee_fba_promo_ativa",
  FBA_PROMO_EXPIRA_EM: "amazon_fee_fba_promo_expira_em",
  FBA_PROMO_UNDER_100: "amazon_fee_fba_promo_under_100_centavos",
  FBA_PROMO_OVER_100: "amazon_fee_fba_promo_over_100_centavos",
  FBA_FALLBACK_POS_PROMO: "amazon_fee_fba_fallback_pos_promo_centavos",
} as const;

const DEFAULTS: FeeEstimateConfig = {
  referralDefaultBps: 1200,
  fbaPromoAtiva: true,
  fbaPromoExpiraEm: new Date("2026-07-31T23:59:59.999-03:00"),
  fbaPromoUnder100Centavos: 500,
  fbaPromoOver100Centavos: 0,
  fbaFallbackPosPromoCentavos: 1005,
};

const PROMO_LIMITE_CENTAVOS = 9999;
const MEDIA_CLOSING_FEE_CENTAVOS = 199;

// ─── Cache de config (TTL 60s) ───
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
 * Cálculo puro local (sem I/O). Aceita categoria opcional para usar tabela rica.
 * Sem categoria → usa cfg.referralDefaultBps (default global 12%, calibrado).
 */
export function calcularFeesLocal(
  valorBrutoCentavos: number,
  cfg: FeeEstimateConfig,
  override?: { comissaoBps?: number; categoriaSlug?: string | null },
  agora = new Date(),
): { comissaoCentavos: number; fbaCentavos: number; closingFeeCentavos: number; categoriaLabel?: string } {
  const bruto = Math.max(0, Math.round(valorBrutoCentavos));

  // Comissão
  let comissaoCentavos: number;
  let categoriaLabel: string | undefined;
  let isMedia = false;

  if (override?.categoriaSlug) {
    const rule = findCommissionRule(override.categoriaSlug);
    if (rule) {
      comissaoCentavos = calcularComissaoCentavos(bruto, rule);
      categoriaLabel = rule.label;
      isMedia = rule.isMedia === true;
    } else {
      // Slug desconhecido — fallback ao default global
      const rateBps = override.comissaoBps ?? cfg.referralDefaultBps;
      comissaoCentavos = Math.round((bruto * rateBps) / 10000);
    }
  } else if (override?.comissaoBps != null) {
    comissaoCentavos = Math.round((bruto * override.comissaoBps) / 10000);
  } else {
    comissaoCentavos = Math.round((bruto * cfg.referralDefaultBps) / 10000);
  }

  // FBA
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

  // Closing fee mídia (Livros/DVD/Música/Games físicos)
  const closingFeeCentavos = isMedia ? MEDIA_CLOSING_FEE_CENTAVOS : 0;

  return { comissaoCentavos, fbaCentavos, closingFeeCentavos, categoriaLabel };
}

// ─── Memory cache (Map, TTL 5min) ───
type MemoryCacheEntry = { value: FeeEstimateResult; at: number };
const memoryCache = new Map<string, MemoryCacheEntry>();
const MEMORY_CACHE_TTL_MS = 5 * 60_000;
const MEMORY_CACHE_MAX_ENTRIES = 5000;

function memoryCacheKey(produtoId: string, brutoCentavos: number, qtd: number, categoriaSlug?: string | null) {
  return `${produtoId}:${brutoCentavos}:${qtd}:${categoriaSlug ?? ""}`;
}

export function invalidateFeeEstimateMemoryCache(produtoId?: string) {
  if (!produtoId) {
    memoryCache.clear();
    return;
  }
  const prefix = `${produtoId}:`;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
}

function memoryCacheGet(key: string, now: number): FeeEstimateResult | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (now - entry.at >= MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memoryCacheSet(key: string, value: FeeEstimateResult, now: number) {
  // LRU lite: se excedeu o limite, apaga 20% mais antigos.
  if (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const toRemove = Math.floor(MEMORY_CACHE_MAX_ENTRIES * 0.2);
    let i = 0;
    for (const k of memoryCache.keys()) {
      if (i++ >= toRemove) break;
      memoryCache.delete(k);
    }
  }
  memoryCache.set(key, { value, at: now });
}

/**
 * Estima as taxas para UMA linha de venda.
 *
 * - Se taxasReaisCentavos > 0 → retorna esse valor com origem="real" (não recalcula).
 * - Senão tenta memory cache (O(1)) → AmazonFeeEstimate (DB) → fallback local puro.
 *
 * `categoriaSlug` opcional: quando passado, usa regra da tabela rica (tier + closing fee).
 * Caso contrário, usa default global 12%.
 */
export async function estimarFeesVenda(input: {
  produtoId: string;
  valorBrutoCentavos: number;
  quantidade: number;
  taxasReaisCentavos: number;
  categoriaSlug?: string | null;
  cfg?: FeeEstimateConfig;
  agora?: Date;
}): Promise<FeeEstimateResult> {
  if (input.taxasReaisCentavos > 0) {
    return {
      taxasCentavos: input.taxasReaisCentavos,
      origem: "real",
      ruleVersion: "amazon-finance",
      breakdown: { comissaoCentavos: 0, fbaCentavos: 0, closingFeeCentavos: 0 },
    };
  }

  const now = (input.agora ?? new Date()).getTime();
  const cacheKey = memoryCacheKey(
    input.produtoId,
    input.valorBrutoCentavos,
    input.quantidade,
    input.categoriaSlug,
  );
  const memHit = memoryCacheGet(cacheKey, now);
  if (memHit) return memHit;

  const cfg = input.cfg ?? (await loadFeeEstimatorConfig());
  const agora = input.agora ?? new Date();
  const quantidade = Math.max(1, input.quantidade);

  const cache = await db.amazonFeeEstimate.findUnique({
    where: { produtoId: input.produtoId },
  });

  let result: FeeEstimateResult;

  if (cache && cache.origem === "api") {
    const local = calcularFeesLocal(
      input.valorBrutoCentavos,
      cfg,
      { comissaoBps: cache.comissaoBps, categoriaSlug: input.categoriaSlug },
      agora,
    );
    const fbaTotal = local.fbaCentavos * quantidade;
    const closingTotal = local.closingFeeCentavos * quantidade;
    result = {
      taxasCentavos: local.comissaoCentavos + fbaTotal + closingTotal,
      origem: "api",
      ruleVersion: cache.ruleVersion ?? "spapi-cache",
      breakdown: {
        comissaoCentavos: local.comissaoCentavos,
        fbaCentavos: fbaTotal,
        closingFeeCentavos: closingTotal,
      },
      categoriaLabel: local.categoriaLabel,
    };
  } else {
    const local = calcularFeesLocal(
      input.valorBrutoCentavos,
      cfg,
      { categoriaSlug: input.categoriaSlug },
      agora,
    );
    const fbaTotal = local.fbaCentavos * quantidade;
    const closingTotal = local.closingFeeCentavos * quantidade;
    result = {
      taxasCentavos: local.comissaoCentavos + fbaTotal + closingTotal,
      origem: "local",
      ruleVersion: RULE_VERSION_LOCAL,
      breakdown: {
        comissaoCentavos: local.comissaoCentavos,
        fbaCentavos: fbaTotal,
        closingFeeCentavos: closingTotal,
      },
      categoriaLabel: local.categoriaLabel,
    };
  }

  memoryCacheSet(cacheKey, result, now);
  return result;
}

export const __test_utils__ = {
  DEFAULTS,
  PROMO_LIMITE_CENTAVOS,
  MEDIA_CLOSING_FEE_CENTAVOS,
  COMMISSION_TABLE,
  memoryCache,
  MEMORY_CACHE_TTL_MS,
};
