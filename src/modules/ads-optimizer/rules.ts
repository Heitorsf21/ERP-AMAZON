export const BID_STEP_CENTAVOS = 5;
export const ZERO_SALES_CLICKS_THRESHOLD = 25;
export const LOW_ACOS_THRESHOLD = 0.15;
export const REDUCE_BID_ACOS_THRESHOLD = 0.3;
export const HIGH_ACOS_THRESHOLD = 0.5;

export type AdsOptimizerEntityType = "KEYWORD" | "TARGET" | "SEARCH_TERM";

export type AdsOptimizerActionType =
  | "INCREASE_BID"
  | "DECREASE_BID"
  | "PAUSE_KEYWORD"
  | "PAUSE_TARGET"
  | "ADD_NEGATIVE_KEYWORD"
  | "ADD_NEGATIVE_TARGET"
  | "CREATE_EXACT_KEYWORD";

export type AdsOptimizerSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AdsOptimizerMetrics = {
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  pedidos: number;
  unidades: number;
  acos: number | null;
  roas: number | null;
  ctr: number | null;
  cpcCentavos: number | null;
  conversao: number | null;
};

export type AdsOptimizerRuleInput = {
  entityType: AdsOptimizerEntityType;
  entityId: string;
  label: string;
  campaignId: string;
  adGroupId: string | null;
  keywordId: string | null;
  targetId: string | null;
  searchTerm: string | null;
  matchType: string | null;
  estado: string | null;
  currentBidCentavos: number | null;
  metrics7d: AdsOptimizerMetrics;
  metricsPrev7d: AdsOptimizerMetrics;
  metrics30d: AdsOptimizerMetrics;
  metricsLifetime: AdsOptimizerMetrics;
};

export type AdsOptimizerRuleRecommendation = {
  actionType: AdsOptimizerActionType;
  severity: AdsOptimizerSeverity;
  ruleId: string;
  motivo: string;
  risco: string;
  confianca: number;
  proposedBidCentavos: number | null;
  proposedState: string | null;
};

const EMPTY: AdsOptimizerRuleRecommendation[] = [];

export function evaluateAdsOptimizerRules(
  input: AdsOptimizerRuleInput,
): AdsOptimizerRuleRecommendation[] {
  if (isInactive(input.estado)) return EMPTY;

  const recs: AdsOptimizerRuleRecommendation[] = [];
  const m7 = input.metrics7d;
  const prev7 = input.metricsPrev7d;
  const m30 = input.metrics30d;
  const lifetime = input.metricsLifetime;

  if (input.entityType === "SEARCH_TERM") {
    if (m30.cliques >= ZERO_SALES_CLICKS_THRESHOLD && m30.pedidos === 0) {
      recs.push({
        actionType: input.targetId ? "ADD_NEGATIVE_TARGET" : "ADD_NEGATIVE_KEYWORD",
        severity: "CRITICAL",
        ruleId: "SEARCH_TERM_25_CLICKS_ZERO_SALES",
        motivo: `${input.label} teve ${m30.cliques} cliques em 30 dias sem vendas. Negativar evita continuar comprando tráfego sem conversão.`,
        risco: "Pode bloquear termos próximos; revisar se o termo é estratégico antes de aprovar.",
        confianca: 92,
        proposedBidCentavos: null,
        proposedState: "enabled",
      });
      return recs;
    }

    if (
      m30.pedidos >= 2 &&
      m30.acos != null &&
      m30.acos <= LOW_ACOS_THRESHOLD &&
      isBroadOrAuto(input.matchType)
    ) {
      recs.push({
        actionType: "CREATE_EXACT_KEYWORD",
        severity: "LOW",
        ruleId: "SEARCH_TERM_GOOD_HARVEST_EXACT",
        motivo: `${input.label} converteu com ACOS ${(m30.acos * 100).toFixed(1)}% em 30 dias. Criar exact permite controlar lance e orçamento com mais precisão.`,
        risco: "Pode duplicar tráfego se a campanha original continuar capturando o mesmo termo.",
        confianca: 78,
        proposedBidCentavos: input.currentBidCentavos ?? 50,
        proposedState: "enabled",
      });
    }
    return recs;
  }

  if (m30.cliques >= ZERO_SALES_CLICKS_THRESHOLD && m30.pedidos === 0) {
    recs.push({
      actionType: input.entityType === "TARGET" ? "PAUSE_TARGET" : "PAUSE_KEYWORD",
      severity: "CRITICAL",
      ruleId: "TARGET_25_CLICKS_ZERO_SALES",
      motivo: `${input.label} teve ${m30.cliques} cliques em 30 dias e nenhuma venda. Pausar interrompe gasto improdutivo.`,
      risco: "Se o produto teve ruptura, preço fora do normal ou listing em teste, a pausa pode cortar aprendizado.",
      confianca: 94,
      proposedBidCentavos: null,
      proposedState: "paused",
    });
    return recs;
  }

  if (
    hasAcosAtLeast(m7, HIGH_ACOS_THRESHOLD) &&
    hasAcosAtLeast(prev7, HIGH_ACOS_THRESHOLD)
  ) {
    recs.push({
      actionType: input.entityType === "TARGET" ? "PAUSE_TARGET" : "PAUSE_KEYWORD",
      severity: "HIGH",
      ruleId: "HIGH_ACOS_TWO_WEEKS",
      motivo: `${input.label} ficou acima de 50% de ACOS por duas semanas consecutivas. O problema parece persistente, não pontual.`,
      risco: "Pausar pode reduzir volume se o termo também trouxer vendas orgânicas ou ranking.",
      confianca: 88,
      proposedBidCentavos: null,
      proposedState: "paused",
    });
    return recs;
  }

  if (hasAcosAtLeast(m30, REDUCE_BID_ACOS_THRESHOLD) && input.currentBidCentavos) {
    recs.push({
      actionType: "DECREASE_BID",
      severity: "MEDIUM",
      ruleId: "ACOS_ABOVE_HEALTHY_REDUCE_BID",
      motivo: `${input.label} está com ACOS ${(m30.acos! * 100).toFixed(1)}% em 30 dias. Reduzir R$0,05 tende a diminuir CPC sem desligar o tráfego.`,
      risco: "Reduzir lance pode diminuir impressões se o termo já estiver competitivo.",
      confianca: 76,
      proposedBidCentavos: Math.max(BID_STEP_CENTAVOS, input.currentBidCentavos - BID_STEP_CENTAVOS),
      proposedState: null,
    });
  }

  if (
    m30.pedidos >= 2 &&
    m7.pedidos > 0 &&
    m30.acos != null &&
    m7.acos != null &&
    m30.acos <= LOW_ACOS_THRESHOLD &&
    m7.acos <= LOW_ACOS_THRESHOLD &&
    input.currentBidCentavos
  ) {
    recs.push({
      actionType: "INCREASE_BID",
      severity: "LOW",
      ruleId: "ACOS_LOW_INCREASE_BID",
      motivo: `${input.label} está saudável em 7d e 30d, com ACOS abaixo de 15%. Aumentar R$0,05 pode capturar mais volume mantendo margem.`,
      risco: "Aumentar lance pode elevar CPC; revisar após a próxima janela de dados.",
      confianca: 74,
      proposedBidCentavos: input.currentBidCentavos + BID_STEP_CENTAVOS,
      proposedState: null,
    });
  }

  return recs.slice(0, 1);
}

export function emptyMetrics(): AdsOptimizerMetrics {
  return {
    impressoes: 0,
    cliques: 0,
    gastoCentavos: 0,
    vendasCentavos: 0,
    pedidos: 0,
    unidades: 0,
    acos: null,
    roas: null,
    ctr: null,
    cpcCentavos: null,
    conversao: null,
  };
}

export function deriveMetrics(base: {
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  pedidos: number;
  unidades: number;
}): AdsOptimizerMetrics {
  return {
    ...base,
    acos:
      base.vendasCentavos > 0 ? base.gastoCentavos / base.vendasCentavos : null,
    roas:
      base.gastoCentavos > 0 ? base.vendasCentavos / base.gastoCentavos : null,
    ctr: base.impressoes > 0 ? base.cliques / base.impressoes : null,
    cpcCentavos:
      base.cliques > 0 ? Math.round(base.gastoCentavos / base.cliques) : null,
    conversao: base.cliques > 0 ? base.pedidos / base.cliques : null,
  };
}

function hasAcosAtLeast(metrics: AdsOptimizerMetrics, threshold: number) {
  return metrics.pedidos > 0 && metrics.acos != null && metrics.acos >= threshold;
}

function isInactive(estado: string | null) {
  const normalized = estado?.toLowerCase();
  return normalized === "paused" || normalized === "archived";
}

function isBroadOrAuto(matchType: string | null) {
  const normalized = matchType?.toUpperCase() ?? "";
  return (
    normalized.includes("BROAD") ||
    normalized.includes("PHRASE") ||
    normalized.includes("AUTO")
  );
}
