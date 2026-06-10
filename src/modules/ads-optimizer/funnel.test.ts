import { describe, expect, it } from "vitest";
import { deriveMetrics, emptyMetrics } from "./metrics";
import {
  evaluateAdsOptimizerFunnel,
  type AdsOptimizerFunnelInput,
  type FunnelLastAction,
} from "./funnel";
import { FUNNEL_BID_STEP_CENTAVOS } from "./funnel-params";

function m(over: Partial<Parameters<typeof deriveMetrics>[0]> = {}) {
  return deriveMetrics({
    impressoes: 1000,
    cliques: 10,
    gastoCentavos: 1000,
    vendasCentavos: 5000,
    pedidos: 1,
    unidades: 1,
    ...over,
  });
}

function input(over: Partial<AdsOptimizerFunnelInput> = {}): AdsOptimizerFunnelInput {
  return {
    entityType: "KEYWORD",
    entityId: "kw-1",
    label: "termo teste",
    keywordId: "kw-1",
    targetId: null,
    searchTerm: null,
    matchType: "BROAD",
    estado: "enabled",
    currentBidCentavos: 100,
    metrics7d: emptyMetrics(),
    metrics30d: emptyMetrics(),
    metrics65d: emptyMetrics(),
    metricsLifetime: emptyMetrics(),
    lastAction: null,
    ...over,
  };
}

// Default: reducao de lance madura (9 dias, 15 cliques) com baseline ACOS 40%
// e pos-mudanca ACOS 30% (1500/5000) — melhora de 10pp, exatamente no limiar.
function lastAction(over: Partial<FunnelLastAction> = {}): FunnelLastAction {
  return {
    actionType: "DECREASE_BID",
    executadoEm: new Date("2026-06-01T12:00:00Z"),
    diasDesdeMudanca: 9,
    baselineAcos30d: 0.4,
    postChange: m({ cliques: 15, gastoCentavos: 1500, vendasCentavos: 5000 }),
    ...over,
  };
}

describe("evaluateAdsOptimizerFunnel — passo 0: observacao", () => {
  it("nao age quando a ultima acao tem menos de 7 dias", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({ diasDesdeMudanca: 3 }),
        metrics7d: m({ cliques: 30, pedidos: 0, vendasCentavos: 0 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("nao age quando a ultima acao tem menos de 10 cliques acumulados", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({
          diasDesdeMudanca: 9,
          postChange: m({ cliques: 4 }),
        }),
        metrics7d: m({ cliques: 30, pedidos: 0, vendasCentavos: 0 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("entidade pausada/arquivada nunca gera acao", () => {
    expect(evaluateAdsOptimizerFunnel(input({ estado: "paused" }))).toEqual([]);
    expect(evaluateAdsOptimizerFunnel(input({ estado: "archived" }))).toEqual([]);
  });
});

describe("evaluateAdsOptimizerFunnel — passo 4: feedback da otimizacao", () => {
  // Caso-teste 7 do spec: reduzida ha 8 dias, >=10 cliques, ACOS pos nao melhorou 10pp.
  it("escala pro corte quando a reducao nao melhorou o ACOS em 10pp", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({
          diasDesdeMudanca: 8,
          baselineAcos30d: 0.4,
          // pos-mudanca: ACOS 0.36 → melhora de 4pp < 10pp
          postChange: m({ cliques: 12, gastoCentavos: 1800, vendasCentavos: 5000 }),
        }),
        metrics7d: m({ cliques: 12, gastoCentavos: 1800, vendasCentavos: 5000 }),
        metrics30d: m({ cliques: 40, gastoCentavos: 6000, vendasCentavos: 16000 }),
        metrics65d: m({ cliques: 80, gastoCentavos: 12000, vendasCentavos: 30000 }),
        metricsLifetime: m({ cliques: 100, gastoCentavos: 15000, vendasCentavos: 40000 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "PAUSE_KEYWORD",
      ruleId: "FUNNEL_FEEDBACK_NO_IMPROVEMENT",
      proposedState: "paused",
    });
  });

  it("segue o funil normal quando a reducao melhorou >= 10pp", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({
          diasDesdeMudanca: 9,
          baselineAcos30d: 0.4,
          // pos: ACOS 0.25 → melhora de 15pp
          postChange: m({ cliques: 16, gastoCentavos: 2000, vendasCentavos: 8000 }),
        }),
        // ativa, convertendo, ACOS medio — nenhum ramo dispara → sem acao
        metrics7d: m({ cliques: 16, gastoCentavos: 2000, vendasCentavos: 8000 }),
        metrics30d: m({ cliques: 60, gastoCentavos: 8000, vendasCentavos: 32000 }),
        metrics65d: m({ cliques: 120, gastoCentavos: 16000, vendasCentavos: 64000 }),
        metricsLifetime: m({ cliques: 200, gastoCentavos: 24000, vendasCentavos: 96000 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("nao aplica o feedback a acoes que nao sao reducao de lance (INCREASE_BID)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({
          actionType: "INCREASE_BID",
          diasDesdeMudanca: 8,
          baselineAcos30d: 0.4,
          // "nao melhorou 10pp" — mas isso so condena reducoes; aumento segue o funil
          postChange: m({ cliques: 12, gastoCentavos: 1800, vendasCentavos: 5000 }),
        }),
        metrics7d: m({ cliques: 12, gastoCentavos: 1800, vendasCentavos: 5000 }),
        metrics30d: m({ cliques: 40, gastoCentavos: 6000, vendasCentavos: 16000 }),
        metrics65d: m({ cliques: 80, gastoCentavos: 12000, vendasCentavos: 30000 }),
        metricsLifetime: m({ cliques: 100, gastoCentavos: 15000, vendasCentavos: 40000 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("melhora de exatamente 10pp conta como melhora (sem poeira de float)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({
          diasDesdeMudanca: 9,
          baselineAcos30d: 0.3,
          // pos: ACOS 0.20 → melhora de exatamente 10pp (0.3 - 0.2 = 0.0999... em float)
          postChange: m({ cliques: 12, gastoCentavos: 1000, vendasCentavos: 5000 }),
        }),
        metrics7d: m({ cliques: 12, gastoCentavos: 1000, vendasCentavos: 5000 }),
        metrics30d: m({ cliques: 40, gastoCentavos: 6000, vendasCentavos: 30000 }),
        metrics65d: m({ cliques: 80, gastoCentavos: 12000, vendasCentavos: 60000 }),
        metricsLifetime: m({ cliques: 100, gastoCentavos: 15000, vendasCentavos: 75000 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("baseline ausente nao condena: sem como julgar, segue o funil normal", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        lastAction: lastAction({
          diasDesdeMudanca: 9,
          baselineAcos30d: null,
          postChange: m({ cliques: 12, gastoCentavos: 1800, vendasCentavos: 5000 }),
        }),
        // funil normal com metricas neutras → nenhuma acao
        metrics7d: m({ cliques: 12, gastoCentavos: 1800, vendasCentavos: 5000 }),
        metrics30d: m({ cliques: 40, gastoCentavos: 6000, vendasCentavos: 16000 }),
        metrics65d: m({ cliques: 80, gastoCentavos: 12000, vendasCentavos: 30000 }),
        metricsLifetime: m({ cliques: 100, gastoCentavos: 15000, vendasCentavos: 40000 }),
      }),
    );
    expect(result).toEqual([]);
  });
});

describe("evaluateAdsOptimizerFunnel — passo 1: recencia", () => {
  // Caso-teste 1 do spec: "almofada ortopedica".
  it("dormente com ACOS 65d abaixo de 50% → SUBIR LANCE (nunca pausar)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 80,
        metrics7d: emptyMetrics(),
        // 30d com 31c/0p tambem satisfaz o gatilho do passo 2 — DE PROPOSITO:
        // este e o caso real "almofada ortopedica"; o passo 1 (dormente) DEVE
        // vencer o passo 2 e revive, nunca pausar.
        metrics30d: m({ cliques: 31, gastoCentavos: 2890, vendasCentavos: 0, pedidos: 0 }),
        // vida: 68 cliques, 2 pedidos, ACOS 38%
        metrics65d: m({ cliques: 68, gastoCentavos: 3800, vendasCentavos: 10000, pedidos: 2 }),
        metricsLifetime: m({ cliques: 68, gastoCentavos: 3800, vendasCentavos: 10000, pedidos: 2 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "INCREASE_BID",
      ruleId: "FUNNEL_DORMANT_REVIVE",
      proposedBidCentavos: 80 + FUNNEL_BID_STEP_CENTAVOS,
    });
  });

  it("dormente com ACOS 65d acima de 50% → PAUSAR", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        metrics7d: emptyMetrics(),
        metrics30d: m({ cliques: 10, gastoCentavos: 3000, vendasCentavos: 4000 }),
        metrics65d: m({ cliques: 40, gastoCentavos: 6000, vendasCentavos: 10000, pedidos: 2 }),
        metricsLifetime: m({ cliques: 40, gastoCentavos: 6000, vendasCentavos: 10000, pedidos: 2 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "PAUSE_KEYWORD",
      ruleId: "FUNNEL_DORMANT_BAD_HISTORY",
    });
  });

  // Caso-teste 4 do spec: eficiencia crescente.
  it("cliques caindo + ACOS melhorando → SEGURAR (sem acao)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        // ritmo 30d = 30 * 7/30 = 7; threshold material = 7 * 0.7 = 4.9; 4 < 4.9
        metrics7d: m({ cliques: 4, gastoCentavos: 400, vendasCentavos: 4000 }), // ACOS 10%
        metrics30d: m({ cliques: 30, gastoCentavos: 3000, vendasCentavos: 15000 }), // ACOS 20%
        metrics65d: m({ cliques: 60, gastoCentavos: 6000, vendasCentavos: 30000 }),
        metricsLifetime: m({ cliques: 90, gastoCentavos: 9000, vendasCentavos: 45000 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("cliques caindo + ACOS piorando → REDUZIR LANCE", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 100,
        metrics7d: m({ cliques: 4, gastoCentavos: 1600, vendasCentavos: 4000 }), // ACOS 40%
        metrics30d: m({ cliques: 30, gastoCentavos: 3000, vendasCentavos: 15000 }), // ACOS 20%
        metrics65d: m({ cliques: 60, gastoCentavos: 6000, vendasCentavos: 30000 }),
        metricsLifetime: m({ cliques: 90, gastoCentavos: 9000, vendasCentavos: 45000 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "DECREASE_BID",
      ruleId: "FUNNEL_DECLINING_WORSE",
      proposedBidCentavos: 100 - FUNNEL_BID_STEP_CENTAVOS,
    });
  });
});

describe("evaluateAdsOptimizerFunnel — passo 2: conversao", () => {
  // Caso-teste 3 do spec: sem salvacao.
  it("25+ cliques, 0 venda na vida, sem historico bom → CORTAR direto", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        metrics7d: m({ cliques: 12, gastoCentavos: 1200, vendasCentavos: 0, pedidos: 0 }),
        metrics30d: m({ cliques: 27, gastoCentavos: 2700, vendasCentavos: 0, pedidos: 0 }),
        metrics65d: m({ cliques: 27, gastoCentavos: 2700, vendasCentavos: 0, pedidos: 0 }),
        metricsLifetime: m({ cliques: 27, gastoCentavos: 2700, vendasCentavos: 0, pedidos: 0 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "PAUSE_KEYWORD",
      ruleId: "FUNNEL_NO_SALES_CUT",
      severity: "CRITICAL",
    });
  });

  it("25+ cliques sem venda na janela MAS historico bom (vida < 15%) → REDUZIR + observar", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 90,
        metrics7d: m({ cliques: 26, gastoCentavos: 2600, vendasCentavos: 0, pedidos: 0 }),
        metrics30d: m({ cliques: 50, gastoCentavos: 5000, vendasCentavos: 20000, pedidos: 3 }),
        metrics65d: m({ cliques: 120, gastoCentavos: 9000, vendasCentavos: 80000, pedidos: 10 }),
        // vida: ACOS 11% com vendas
        metricsLifetime: m({ cliques: 200, gastoCentavos: 11000, vendasCentavos: 100000, pedidos: 15 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "DECREASE_BID",
      ruleId: "FUNNEL_NO_SALES_GOOD_HISTORY",
      proposedBidCentavos: 90 - FUNNEL_BID_STEP_CENTAVOS,
    });
  });

  it("targets cortam com PAUSE_TARGET", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        entityType: "TARGET",
        entityId: "tg-1",
        keywordId: null,
        targetId: "tg-1",
        metrics30d: m({ cliques: 30, gastoCentavos: 3000, vendasCentavos: 0, pedidos: 0 }),
        metrics7d: m({ cliques: 10, gastoCentavos: 1000, vendasCentavos: 0, pedidos: 0 }),
        metrics65d: m({ cliques: 30, gastoCentavos: 3000, vendasCentavos: 0, pedidos: 0 }),
        metricsLifetime: m({ cliques: 30, gastoCentavos: 3000, vendasCentavos: 0, pedidos: 0 }),
      }),
    );
    expect(result[0]).toMatchObject({ actionType: "PAUSE_TARGET", ruleId: "FUNNEL_NO_SALES_CUT" });
  });
});

describe("evaluateAdsOptimizerFunnel — passo 3: desempenho multi-janela", () => {
  // Caso-teste 5 do spec.
  it("ACOS < 15% em 7d E 30d E 65d → SUBIR LANCE (vencedora estavel)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 120,
        metrics7d: m({ cliques: 10, gastoCentavos: 500, vendasCentavos: 5000 }), // 10%
        metrics30d: m({ cliques: 40, gastoCentavos: 2000, vendasCentavos: 16000 }), // 12.5%
        metrics65d: m({ cliques: 80, gastoCentavos: 4200, vendasCentavos: 30000 }), // 14%
        metricsLifetime: m({ cliques: 120, gastoCentavos: 6000, vendasCentavos: 48000 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "INCREASE_BID",
      ruleId: "FUNNEL_STABLE_WINNER",
      proposedBidCentavos: 120 + FUNNEL_BID_STEP_CENTAVOS,
    });
  });

  it("7d otimo E 30d < 25% → SUBIR LANCE (forca recente corroborada)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 100,
        metrics7d: m({ cliques: 10, gastoCentavos: 450, vendasCentavos: 5000 }), // 9%
        metrics30d: m({ cliques: 40, gastoCentavos: 4000, vendasCentavos: 20000 }), // 20%
        metrics65d: m({ cliques: 80, gastoCentavos: 9000, vendasCentavos: 30000 }), // 30%
        metricsLifetime: m({ cliques: 120, gastoCentavos: 12000, vendasCentavos: 40000 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "INCREASE_BID",
      ruleId: "FUNNEL_RECENT_STRENGTH",
    });
  });

  // Caso-teste 6 do spec: bom momento enganoso.
  it("7d otimo MAS 30d > 25% → SEGURAR (nao sobe lance)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 100,
        metrics7d: m({ cliques: 10, gastoCentavos: 450, vendasCentavos: 5000 }), // 9%
        metrics30d: m({ cliques: 40, gastoCentavos: 5600, vendasCentavos: 20000 }), // 28%
        metrics65d: m({ cliques: 80, gastoCentavos: 9000, vendasCentavos: 30000 }),
        metricsLifetime: m({ cliques: 120, gastoCentavos: 12000, vendasCentavos: 40000 }),
      }),
    );
    expect(result).toEqual([]);
  });

  // Caso-teste 2 do spec: lance alto, palavra boa.
  it("converte + vida saudavel MAS 7d disparou (>=50%) → REDUZIR LANCE (nao pausar)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 150,
        // 7d: 20 cliques, 1 venda, ACOS 55%
        metrics7d: m({ cliques: 20, gastoCentavos: 5500, vendasCentavos: 10000, pedidos: 1 }),
        // 30d: 45 cliques, 3 vendas
        metrics30d: m({ cliques: 45, gastoCentavos: 10000, vendasCentavos: 33000, pedidos: 3 }),
        metrics65d: m({ cliques: 100, gastoCentavos: 24000, vendasCentavos: 80000, pedidos: 10 }),
        // vida: ACOS 30%
        metricsLifetime: m({ cliques: 150, gastoCentavos: 30000, vendasCentavos: 100000, pedidos: 10 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "DECREASE_BID",
      ruleId: "FUNNEL_SPIKE_HIGH_BID",
      proposedBidCentavos: 150 - FUNNEL_BID_STEP_CENTAVOS,
    });
  });

  it("lance nunca cai abaixo do passo minimo", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 7,
        metrics7d: m({ cliques: 20, gastoCentavos: 5500, vendasCentavos: 10000, pedidos: 1 }),
        metrics30d: m({ cliques: 45, gastoCentavos: 10000, vendasCentavos: 33000, pedidos: 3 }),
        metrics65d: m({ cliques: 100, gastoCentavos: 24000, vendasCentavos: 80000, pedidos: 10 }),
        metricsLifetime: m({ cliques: 150, gastoCentavos: 30000, vendasCentavos: 100000, pedidos: 10 }),
      }),
    );
    expect(result[0]?.proposedBidCentavos).toBe(FUNNEL_BID_STEP_CENTAVOS);
  });
});

describe("evaluateAdsOptimizerFunnel — termos de busca (SEARCH_TERM)", () => {
  function searchTermInput(over: Partial<AdsOptimizerFunnelInput> = {}) {
    return input({
      entityType: "SEARCH_TERM",
      entityId: "SEARCH_TERM:camp-1:ag-1:kw-1:tapete",
      label: "tapete",
      searchTerm: "tapete",
      matchType: "BROAD",
      ...over,
    });
  }

  it("termo com 25+ cliques e 0 venda na vida → negativar keyword", () => {
    const zero = m({ cliques: 26, gastoCentavos: 2600, vendasCentavos: 0, pedidos: 0 });
    const result = evaluateAdsOptimizerFunnel(
      searchTermInput({
        metrics7d: zero,
        metrics30d: zero,
        metrics65d: zero,
        metricsLifetime: zero,
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "ADD_NEGATIVE_KEYWORD",
      ruleId: "FUNNEL_ST_NEGATE",
    });
  });

  it("termo formato ASIN → negativar target", () => {
    const zero = m({ cliques: 30, gastoCentavos: 3000, vendasCentavos: 0, pedidos: 0 });
    const result = evaluateAdsOptimizerFunnel(
      searchTermInput({
        label: "B0ABCD1234",
        searchTerm: "B0ABCD1234",
        metrics7d: zero,
        metrics30d: zero,
        metrics65d: zero,
        metricsLifetime: zero,
      }),
    );
    expect(result[0]).toMatchObject({ actionType: "ADD_NEGATIVE_TARGET" });
  });

  it("termo com historico bom (vida < 15%) NAO e negativado por um tropeço de janela", () => {
    const result = evaluateAdsOptimizerFunnel(
      searchTermInput({
        metrics7d: m({ cliques: 26, gastoCentavos: 2600, vendasCentavos: 0, pedidos: 0 }),
        // 30d ACOS ~23% (> 15%) de proposito: impede o ramo de harvest de disparar,
        // isolando o teste no veto de negativacao por historico bom.
        metrics30d: m({ cliques: 40, gastoCentavos: 7000, vendasCentavos: 30000, pedidos: 3 }),
        metrics65d: m({ cliques: 90, gastoCentavos: 8000, vendasCentavos: 60000, pedidos: 8 }),
        metricsLifetime: m({ cliques: 150, gastoCentavos: 10000, vendasCentavos: 80000, pedidos: 12 }),
      }),
    );
    expect(result).toEqual([]);
  });

  it("harvest: termo broad/auto com >=2 pedidos e ACOS <=15% em 30d → criar exata", () => {
    const result = evaluateAdsOptimizerFunnel(
      searchTermInput({
        currentBidCentavos: 70,
        metrics30d: m({ cliques: 20, gastoCentavos: 1200, vendasCentavos: 10000, pedidos: 2 }),
        metrics7d: m({ cliques: 5, gastoCentavos: 300, vendasCentavos: 2500, pedidos: 1 }),
        metrics65d: m({ cliques: 30, gastoCentavos: 1800, vendasCentavos: 15000, pedidos: 3 }),
        metricsLifetime: m({ cliques: 40, gastoCentavos: 2400, vendasCentavos: 20000, pedidos: 4 }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      actionType: "CREATE_EXACT_KEYWORD",
      ruleId: "FUNNEL_ST_HARVEST",
      proposedBidCentavos: 70,
    });
  });

  it("harvest NAO dispara para match exact", () => {
    const result = evaluateAdsOptimizerFunnel(
      searchTermInput({
        matchType: "EXACT",
        metrics30d: m({ cliques: 20, gastoCentavos: 1200, vendasCentavos: 10000, pedidos: 2 }),
      }),
    );
    expect(result).toEqual([]);
  });
});
