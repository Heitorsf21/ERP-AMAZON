import {
  FUNNEL_ACCEPTABLE_ACOS_30D,
  FUNNEL_BID_STEP_CENTAVOS,
  FUNNEL_COMFORT_ACOS,
  FUNNEL_DECLINE_PACE_RATIO,
  FUNNEL_DORMANT_MAX_CLICKS_7D,
  FUNNEL_GOOD_LIFETIME_ACOS,
  FUNNEL_HARVEST_MIN_ORDERS_30D,
  FUNNEL_IMPROVEMENT_MIN_PP,
  FUNNEL_OBSERVATION_MIN_CLICKS,
  FUNNEL_OBSERVATION_MIN_DAYS,
  FUNNEL_PAUSE_ACOS_65D,
  FUNNEL_SPIKE_ACOS_7D,
  FUNNEL_ZERO_SALES_CLICKS,
} from "./funnel-params";
import type { AdsOptimizerMetrics } from "./metrics";

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

/** Ultima acao APLICADA na Amazon para esta entidade (memoria do funil). */
export type FunnelLastAction = {
  actionType: string;
  executadoEm: Date;
  /** Dias corridos desde a execucao. */
  diasDesdeMudanca: number;
  /** ACOS 30d no momento da acao (baseline do julgamento). */
  baselineAcos30d: number | null;
  /** Metricas acumuladas desde a mudanca, descontando os dias provisorios. */
  postChange: AdsOptimizerMetrics;
};

export type AdsOptimizerFunnelInput = {
  entityType: AdsOptimizerEntityType;
  entityId: string;
  label: string;
  keywordId: string | null;
  targetId: string | null;
  searchTerm: string | null;
  matchType: string | null;
  estado: string | null;
  currentBidCentavos: number | null;
  metrics7d: AdsOptimizerMetrics;
  metrics30d: AdsOptimizerMetrics;
  metrics65d: AdsOptimizerMetrics;
  metricsLifetime: AdsOptimizerMetrics;
  lastAction: FunnelLastAction | null;
};

export type AdsOptimizerFunnelRecommendation = {
  actionType: AdsOptimizerActionType;
  severity: AdsOptimizerSeverity;
  ruleId: string;
  motivo: string;
  risco: string;
  confianca: number;
  proposedBidCentavos: number | null;
  proposedState: string | null;
};

const EMPTY: AdsOptimizerFunnelRecommendation[] = [];

/**
 * Funil de decisao do otimizador (spec 2026-06-10 §4).
 * Principio: nenhuma acao forte com base numa unica janela; volume nao e meta;
 * so se pausa o que esta gastando ou o que provou nao ter conserto barato.
 */
export function evaluateAdsOptimizerFunnel(
  input: AdsOptimizerFunnelInput,
): AdsOptimizerFunnelRecommendation[] {
  if (isInactive(input.estado)) return EMPTY;

  if (input.entityType === "SEARCH_TERM") return evaluateSearchTerm(input);

  const { metrics7d: m7, metrics30d: m30, metrics65d: m65, metricsLifetime: vida } = input;

  // PASSO 0 — em observacao: acao recente ainda sem dado maduro. Nao mexe.
  if (input.lastAction && isUnderObservation(input.lastAction)) return EMPTY;

  // PASSO 4 — feedback: a reducao de lance madura precisa ter melhorado >= 10pp,
  // senao a palavra provou nao ter conserto barato.
  if (input.lastAction && input.lastAction.actionType === "DECREASE_BID") {
    const baseline = input.lastAction.baselineAcos30d;
    const postAcos = input.lastAction.postChange.acos;
    // Sem baseline ou sem ACOS pos-mudanca nao ha como julgar o feedback —
    // ausencia de informacao NAO e prova de fracasso; segue o funil normal
    // (o passo 2 corta com prova propria se continuar sem vendas).
    if (baseline != null && postAcos != null) {
      // Epsilon contra poeira de float: 0.30 - 0.20 === 0.0999... em IEEE-754.
      const improved = baseline - postAcos >= FUNNEL_IMPROVEMENT_MIN_PP - 1e-9;
      if (!improved) {
        return [cut(input, "FUNNEL_FEEDBACK_NO_IMPROVEMENT", "HIGH", 88,
          `${input.label} foi otimizada ha ${input.lastAction.diasDesdeMudanca} dias e o ACOS pos-mudanca (${pct(postAcos)}) nao melhorou 10pp sobre o baseline (${pct(baseline)}). Reduzir R$0,05 nao resolveu — e gasto sem conserto barato.`,
          "Conversoes atribuidas tardiamente ainda podem entrar; o dado ja descontou os dias provisorios.")];
      }
      // Melhorou: segue o funil normal. Se o ACOS 7d ainda estiver disparado,
      // um novo trim de R$0,05 no mesmo ciclo e INTENCIONAL (descida gradual
      // com observacao de 7 dias entre cada passo).
    }
  }

  // PASSO 1 — recencia: nao se pausa o que nao esta gastando.
  if (m7.cliques <= FUNNEL_DORMANT_MAX_CLICKS_7D) {
    if (acosAtLeast(m65, FUNNEL_PAUSE_ACOS_65D)) {
      return [cut(input, "FUNNEL_DORMANT_BAD_HISTORY", "HIGH", 85,
        `${input.label} esta dormente (sem cliques em 7d) e o ACOS de 65 dias (${pct(m65.acos)}) esta acima de 50%. Caso comprovadamente ruim — nao vale ressuscitar.`,
        "Se houve ruptura de estoque ou teste de listing no periodo, a pausa corta aprendizado.")];
    }
    // Revive exige atividade previa: dormente = "ficou quieta", nao "nunca rodou".
    // Keyword sem nenhum clique em 65d nao tem evidencia para acao — segura.
    if (m65.cliques > 0 && input.currentBidCentavos != null) {
      return [bid(input, +1, "FUNNEL_DORMANT_REVIVE", "LOW", 78,
        `${input.label} esta sem cliques ha 7 dias — provavelmente perdeu impressao por lance baixo. Subir R$0,05 tenta reativar; o historico nao condena a palavra (ACOS 65d ${pct(m65.acos)}).`,
        "Subir lance pode trazer trafego de volta com CPC maior; o ciclo de observacao mede o efeito.")];
    }
    return EMPTY;
  }

  const pace7dFrom30d = m30.cliques * (7 / 30);
  const decliningMaterially =
    pace7dFrom30d > 0 && m7.cliques < pace7dFrom30d * FUNNEL_DECLINE_PACE_RATIO;
  if (decliningMaterially) {
    const improving = m7.acos != null && m30.acos != null && m7.acos < m30.acos;
    const worsening = m7.acos != null && m30.acos != null && m7.acos > m30.acos;
    if (improving) return EMPTY; // eficiencia: ficou seletiva — nao forca volume de volta
    if (worsening && input.currentBidCentavos != null) {
      return [bid(input, -1, "FUNNEL_DECLINING_WORSE", "MEDIUM", 74,
        `${input.label} esta com menos cliques que o proprio ritmo de 30d E o ACOS recente piorou (${pct(m7.acos)} vs ${pct(m30.acos)} em 30d). Declinio real — reduzir R$0,05 para conter o custo.`,
        "Reduzir lance pode derrubar ainda mais o volume; reavaliado apos a janela de observacao.")];
    }
  }

  // PASSO 2 — conversao: 25 cliques sem venda corta, salvo historico bom.
  const zeroSalesWindow =
    (m7.cliques >= FUNNEL_ZERO_SALES_CLICKS && m7.pedidos === 0) ||
    (m30.cliques >= FUNNEL_ZERO_SALES_CLICKS && m30.pedidos === 0) ||
    (vida.cliques >= FUNNEL_ZERO_SALES_CLICKS && vida.pedidos === 0);
  if (zeroSalesWindow) {
    if (hasGoodLifetime(vida)) {
      if (input.currentBidCentavos != null) {
        return [bid(input, -1, "FUNNEL_NO_SALES_GOOD_HISTORY", "MEDIUM", 76,
          `${input.label} bateu ${FUNNEL_ZERO_SALES_CLICKS}+ cliques sem venda numa janela, mas o ACOS de vida (${pct(vida.acos)}) e saudavel. Tropeço ocasional — reduzir R$0,05 e observar antes de cortar.`,
          "Se o ACOS pos-mudanca nao melhorar 10pp, o proximo ciclo corta a palavra.")];
      }
      return EMPTY;
    }
    return [cut(input, "FUNNEL_NO_SALES_CUT", "CRITICAL", 93,
      `${input.label} acumulou ${FUNNEL_ZERO_SALES_CLICKS}+ cliques sem nenhuma venda e nao tem historico bom que justifique salvar. Pausar interrompe gasto improdutivo.`,
      "Se o produto teve ruptura ou preco fora do normal no periodo, a pausa pode cortar aprendizado.")];
  }

  // PASSO 3 — desempenho multi-janela (ancorado nos limiares de ACOS travados).
  const comfort7 = acosBelow(m7, FUNNEL_COMFORT_ACOS);
  if (
    comfort7 &&
    acosBelow(m30, FUNNEL_COMFORT_ACOS) &&
    acosBelow(m65, FUNNEL_COMFORT_ACOS) &&
    input.currentBidCentavos != null
  ) {
    return [bid(input, +1, "FUNNEL_STABLE_WINNER", "LOW", 86,
      `${input.label} mantem ACOS abaixo de 15% em 7d, 30d e 65d — vencedora estavel. Subir R$0,05 captura mais volume mantendo margem.`,
      "Subir lance eleva CPC; o ciclo de observacao confirma se o ACOS se sustenta.")];
  }
  if (comfort7 && acosBelow(m30, FUNNEL_ACCEPTABLE_ACOS_30D) && input.currentBidCentavos != null) {
    return [bid(input, +1, "FUNNEL_RECENT_STRENGTH", "LOW", 72,
      `${input.label} esta otima em 7d (${pct(m7.acos)}) com 30d aceitavel (${pct(m30.acos)} < 25%). Forca recente corroborada — subir R$0,05 com confianca moderada.`,
      "Se o bom momento nao se sustentar, o proximo ciclo corrige o lance de volta.")];
  }
  if (comfort7 && acosAtLeast(m30, FUNNEL_ACCEPTABLE_ACOS_30D)) {
    return EMPTY; // so um bom momento — segura
  }
  const lifetimeHealthy =
    vida.pedidos > 0 && vida.acos != null && vida.acos < FUNNEL_PAUSE_ACOS_65D;
  if (
    converts(m7, m30) &&
    lifetimeHealthy &&
    acosAtLeast(m7, FUNNEL_SPIKE_ACOS_7D) &&
    input.currentBidCentavos != null
  ) {
    return [bid(input, -1, "FUNNEL_SPIKE_HIGH_BID", "MEDIUM", 80,
      `${input.label} converte e tem vida saudavel (${pct(vida.acos)}), mas o ACOS de 7d disparou (${pct(m7.acos)}). A palavra nao e ruim — o lance esta alto. Reduzir R$0,05.`,
      "Reducao reavaliada apos a janela de observacao; sem melhora de 10pp, escala pro corte.")];
  }

  return EMPTY;
}

function evaluateSearchTerm(
  input: AdsOptimizerFunnelInput,
): AdsOptimizerFunnelRecommendation[] {
  const { metrics7d: m7, metrics30d: m30, metricsLifetime: vida } = input;

  const zeroSalesWindow =
    (m7.cliques >= FUNNEL_ZERO_SALES_CLICKS && m7.pedidos === 0) ||
    (m30.cliques >= FUNNEL_ZERO_SALES_CLICKS && m30.pedidos === 0) ||
    (vida.cliques >= FUNNEL_ZERO_SALES_CLICKS && vida.pedidos === 0);
  if (zeroSalesWindow) {
    // Historico bom veta o corte; termo nao tem lance proprio, entao a alavanca
    // de conserto e do keyword/target pai — aqui apenas seguramos.
    if (hasGoodLifetime(vida)) return EMPTY;
    const negateTarget = input.targetId != null || isLikelyAsin(input.searchTerm ?? input.label);
    return [{
      actionType: negateTarget ? "ADD_NEGATIVE_TARGET" : "ADD_NEGATIVE_KEYWORD",
      severity: "CRITICAL",
      ruleId: "FUNNEL_ST_NEGATE",
      motivo: `${input.label} acumulou ${FUNNEL_ZERO_SALES_CLICKS}+ cliques sem venda. Negativar evita continuar comprando trafego sem conversao.`,
      risco: "Pode bloquear termos proximos; revisar se o termo e estrategico antes de aprovar.",
      confianca: 92,
      proposedBidCentavos: null,
      proposedState: "enabled",
    }];
  }

  if (
    m30.pedidos >= FUNNEL_HARVEST_MIN_ORDERS_30D &&
    m30.acos != null &&
    m30.acos <= FUNNEL_GOOD_LIFETIME_ACOS &&
    isBroadOrAuto(input.matchType)
  ) {
    return [{
      actionType: "CREATE_EXACT_KEYWORD",
      severity: "LOW",
      ruleId: "FUNNEL_ST_HARVEST",
      motivo: `${input.label} converteu com ACOS ${pct(m30.acos)} em 30 dias. Criar exact permite controlar lance e orcamento com mais precisao.`,
      risco: "Pode duplicar trafego se a campanha original continuar capturando o mesmo termo.",
      confianca: 78,
      proposedBidCentavos: input.currentBidCentavos ?? 50,
      proposedState: "enabled",
    }];
  }

  return EMPTY;
}

function isUnderObservation(action: FunnelLastAction) {
  return (
    action.diasDesdeMudanca < FUNNEL_OBSERVATION_MIN_DAYS ||
    action.postChange.cliques < FUNNEL_OBSERVATION_MIN_CLICKS
  );
}

function bid(
  input: AdsOptimizerFunnelInput,
  direction: 1 | -1,
  ruleId: string,
  severity: AdsOptimizerSeverity,
  confianca: number,
  motivo: string,
  risco: string,
): AdsOptimizerFunnelRecommendation {
  const current = input.currentBidCentavos ?? FUNNEL_BID_STEP_CENTAVOS;
  const proposed =
    direction > 0
      ? current + FUNNEL_BID_STEP_CENTAVOS
      : Math.max(FUNNEL_BID_STEP_CENTAVOS, current - FUNNEL_BID_STEP_CENTAVOS);
  return {
    actionType: direction > 0 ? "INCREASE_BID" : "DECREASE_BID",
    severity,
    ruleId,
    motivo,
    risco,
    confianca,
    proposedBidCentavos: proposed,
    proposedState: null,
  };
}

function cut(
  input: AdsOptimizerFunnelInput,
  ruleId: string,
  severity: AdsOptimizerSeverity,
  confianca: number,
  motivo: string,
  risco: string,
): AdsOptimizerFunnelRecommendation {
  return {
    actionType: input.entityType === "TARGET" ? "PAUSE_TARGET" : "PAUSE_KEYWORD",
    severity,
    ruleId,
    motivo,
    risco,
    confianca,
    proposedBidCentavos: null,
    proposedState: "paused",
  };
}

function converts(m7: AdsOptimizerMetrics, m30: AdsOptimizerMetrics) {
  return m7.pedidos > 0 || m30.pedidos > 0;
}

function hasGoodLifetime(vida: AdsOptimizerMetrics) {
  return vida.pedidos > 0 && vida.acos != null && vida.acos < FUNNEL_GOOD_LIFETIME_ACOS;
}

function acosBelow(metrics: AdsOptimizerMetrics, threshold: number) {
  return metrics.pedidos > 0 && metrics.acos != null && metrics.acos < threshold;
}

function acosAtLeast(metrics: AdsOptimizerMetrics, threshold: number) {
  return metrics.acos != null && metrics.acos >= threshold;
}

function pct(value: number | null | undefined) {
  return value == null ? "n/d" : `${(value * 100).toFixed(1)}%`;
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

function isLikelyAsin(value: string) {
  return /^B[A-Z0-9]{9}$/i.test(value.trim());
}
