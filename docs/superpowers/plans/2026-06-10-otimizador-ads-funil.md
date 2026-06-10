# Otimizador de Ads — Funil Stateful + Job Automático: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o motor de regras binário do otimizador de Ads por um funil de decisão stateful multi-janela (7d/30d/65d + memória de ações), rodando automaticamente a cada 6h via worker, com a UI limpa de "engrenagem".

**Architecture:** Motor puro novo (`funnel.ts`) ao lado do antigo (`rules.ts`, deletado no final), consumindo um snapshot ampliado (janela 65d + última ação aplicada por entidade + métricas pós-mudança ancoradas em `executadoEm`). Um novo tipo de job (`ADS_OPTIMIZER_CYCLE`) reusa o lifecycle quota-aware de relatórios já existente. **Zero migration de schema** — dados novos (65d, pós-mudança) viajam em `evidenceJson`/snapshot em memória.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma 5.22, vitest, date-fns, React Query.

**Spec:** [docs/superpowers/specs/2026-06-10-otimizador-ads-redesign-design.md](../specs/2026-06-10-otimizador-ads-redesign-design.md)

---

## Contexto essencial para quem nunca viu este código

- **Dinheiro em centavos (`Int`), ACOS em fração** (`0.38` = 38%). Logger `pino`, nunca `console.log`. Validação: `npx tsc --noEmit`, `npx eslint <arquivo>`, `npx vitest run <arquivo>` — nunca `npm run build` sem pedido.
- **Motor atual:** [src/modules/ads-optimizer/rules.ts](../../src/modules/ads-optimizer/rules.ts) — função pura `evaluateAdsOptimizerRules(input)` chamada por `runOptimization` em [src/modules/ads-optimizer/service.ts](../../src/modules/ads-optimizer/service.ts) (~linha 200). O service monta o snapshot em `buildOptimizationSnapshot` (~linha 1280) com janelas 7d/prev7d/30d/lifetime agregadas em memória de `amazonAdsTargetingMetricDaily`/`amazonAdsSearchTermMetricDaily`.
- **Persistência de recomendação:** modelo `AdsOptimizationRecommendation` (status PROPOSED→APPROVED→APPLIED/FAILED, ou REJECTED/STALE). `executadoEm` marca quando a ação foi aplicada na Amazon. Cada nova rodada marca as PROPOSED antigas como STALE.
- **Jobs:** `SCHEDULES` em [src/modules/amazon/jobs.ts](../../src/modules/amazon/jobs.ts) (~linha 140) enfileira por empresa com dedupe por slot de tempo; o worker processa num `switch` em [src/modules/amazon/worker.ts](../../src/modules/amazon/worker.ts) (`processJob`, ~linha 263). Jobs de Ads usam `getAmazonAdsCredentials({ requireProfile: true })` e são isentos de credenciais SP-API via flag `isAdsJob`.
- **ATENÇÃO:** `AMAZON_ADS_REPORT_SYNC`/`AMAZON_ADS_BACKFILL` são de OUTRO pipeline (ads-aggregation do dashboard, `ads-handlers.ts`). Os relatórios do OTIMIZADOR têm lifecycle próprio dentro de `service.ts` (`syncOptimizerReports`, state em `amazonAdsOptimizerState`) — é ESSE que o job novo orquestra.
- **UI:** [src/app/publicidade/otimizador/page.tsx](../../src/app/publicidade/otimizador/page.tsx) — client component único com React Query.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/modules/ads-optimizer/funnel-params.ts` | Criar | Todos os parâmetros travados do spec §9, num lugar só |
| `src/modules/ads-optimizer/metrics.ts` | Criar | `AdsOptimizerMetrics` + `emptyMetrics`/`deriveMetrics` (movidos de rules.ts) |
| `src/modules/ads-optimizer/funnel.ts` | Criar | Motor puro: `evaluateAdsOptimizerFunnel(input)` — o funil do spec §4 |
| `src/modules/ads-optimizer/funnel.test.ts` | Criar | Testes de cada ramo + casos-teste do spec §10 |
| `src/modules/ads-optimizer/service.ts` | Modificar | Snapshot 65d + última ação + pós-mudança; integrar funil; ator de sistema; `runWorkerCycle`; `observations` no getSnapshot |
| `src/modules/ads-optimizer/service.test.ts` | Modificar | Atualizar expects do motor velho → funil |
| `src/modules/shared/domain.ts` | Modificar | Novo `TipoAmazonSyncJob.ADS_OPTIMIZER_CYCLE` |
| `src/modules/amazon/jobs.ts` | Modificar | Schedule 6h |
| `src/modules/amazon/worker.ts` | Modificar | Case do job novo |
| `src/app/publicidade/otimizador/page.tsx` | Modificar | Remover CoveragePanel/SummaryCards/botões; painel "Em observação" |
| `src/modules/ads-optimizer/rules.ts` + `rules.test.ts` | Deletar (Task 8) | Motor antigo aposentado |
| `CLAUDE.md` | Modificar | Atualizar a seção do Otimizador |

**Nota sobre duplicação temporária:** `metrics.ts` duplica `emptyMetrics`/`deriveMetrics` de `rules.ts` durante as Tasks 1–7 (os dois coexistem). A Task 8 deleta `rules.ts` e elimina a duplicação. Isso evita quebrar o motor velho no meio do caminho.

---

### Task 1: Parâmetros centralizados + métricas compartilhadas

**Files:**
- Create: `src/modules/ads-optimizer/funnel-params.ts`
- Create: `src/modules/ads-optimizer/metrics.ts`

- [ ] **Step 1: Criar `funnel-params.ts`** com TODOS os parâmetros do spec §9:

```ts
// Parametros do funil de decisao do otimizador de Ads.
// Travados com o usuario em 2026-06-10 — ver docs/superpowers/specs/2026-06-10-otimizador-ads-redesign-design.md §9.
// Mudar qualquer valor daqui exige reabrir a discussao do spec (§11).

/** Passo fixo de ajuste de lance (R$0,05). E a "unidade do experimento" do ciclo de feedback. */
export const FUNNEL_BID_STEP_CENTAVOS = 5;

/** Dias minimos desde a mudanca antes de julgar o efeito (janela de atribuicao SP = 7d). */
export const FUNNEL_OBSERVATION_MIN_DAYS = 7;

/** Dias para confianca alta no julgamento pos-mudanca. */
export const FUNNEL_OBSERVATION_HIGH_CONFIDENCE_DAYS = 14;

/** Cliques minimos acumulados pos-mudanca para julgar (significancia). */
export const FUNNEL_OBSERVATION_MIN_CLICKS = 10;

/** Ultimos N dias descontados do julgamento (conversoes ainda entrando). */
export const FUNNEL_PROVISIONAL_RECENT_DAYS = 2;

/** Dormente = ate este numero de cliques em 7d (0 = nenhum clique). */
export const FUNNEL_DORMANT_MAX_CLICKS_7D = 0;

/** "Caindo materialmente" = cliques 7d abaixo de (ritmo 30d * este fator). */
export const FUNNEL_DECLINE_PACE_RATIO = 0.7;

/** Gatilho de corte: cliques sem nenhuma venda, em qualquer janela. */
export const FUNNEL_ZERO_SALES_CLICKS = 25;

/** "Historico bom" que veta o corte: ACOS de vida abaixo disso (e com vendas). */
export const FUNNEL_GOOD_LIFETIME_ACOS = 0.15;

/** Meta de conforto — ACOS "otimo". */
export const FUNNEL_COMFORT_ACOS = 0.15;

/** Teto de ACOS 30d para corroborar forca recente (subir lance com confianca media). */
export const FUNNEL_ACCEPTABLE_ACOS_30D = 0.25;

/** ACOS 7d "disparado" (palavra boa com lance alto → reduzir). */
export const FUNNEL_SPIKE_ACOS_7D = 0.5;

/** ACOS muito alto na janela longa (65d) — autoriza pausa. */
export const FUNNEL_PAUSE_ACOS_65D = 0.5;

/** Melhora minima de ACOS pos-otimizacao (pontos percentuais, em fracao: 0.10 = 10pp). */
export const FUNNEL_IMPROVEMENT_MIN_PP = 0.1;

/** Janela longa de avaliacao em dias. */
export const FUNNEL_LONG_WINDOW_DAYS = 65;

/** Harvest de termo bom (mantido do motor antigo): pedidos minimos em 30d. */
export const FUNNEL_HARVEST_MIN_ORDERS_30D = 2;
```

- [ ] **Step 2: Criar `metrics.ts`** copiando de `rules.ts` (linhas 20–32 e 182–217) — conteúdo exato:

```ts
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
```

- [ ] **Step 3: Typecheck e lint**

Run: `npx tsc --noEmit && npx eslint src/modules/ads-optimizer/funnel-params.ts src/modules/ads-optimizer/metrics.ts`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ads-optimizer/funnel-params.ts src/modules/ads-optimizer/metrics.ts
git commit -m "feat(ads-optimizer): parametros do funil centralizados + metricas compartilhadas"
```

---

### Task 2: Testes do funil (RED) — todos os ramos + casos do spec

**Files:**
- Create: `src/modules/ads-optimizer/funnel.test.ts`

O funil será implementado na Task 3. Aqui escrevemos TODOS os testes primeiro e confirmamos que falham (o módulo nem existe ainda).

- [ ] **Step 1: Criar `funnel.test.ts`** com o conteúdo completo:

```ts
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
});

describe("evaluateAdsOptimizerFunnel — passo 1: recencia", () => {
  // Caso-teste 1 do spec: "almofada ortopedica".
  it("dormente com ACOS 65d abaixo de 50% → SUBIR LANCE (nunca pausar)", () => {
    const result = evaluateAdsOptimizerFunnel(
      input({
        currentBidCentavos: 80,
        metrics7d: emptyMetrics(),
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
        metrics30d: m({ cliques: 40, gastoCentavos: 4000, vendasCentavos: 30000, pedidos: 3 }),
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
```

- [ ] **Step 2: Rodar e confirmar que falha** (módulo `./funnel` não existe)

Run: `npx vitest run src/modules/ads-optimizer/funnel.test.ts`
Expected: FAIL — `Cannot find module './funnel'` (ou equivalente).

- [ ] **Step 3: Commit**

```bash
git add src/modules/ads-optimizer/funnel.test.ts
git commit -m "test(ads-optimizer): testes do funil de decisao (red)"
```

---

### Task 3: Implementar o funil (GREEN)

**Files:**
- Create: `src/modules/ads-optimizer/funnel.ts`

- [ ] **Step 1: Criar `funnel.ts`** completo:

```ts
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
    const improved =
      baseline != null && postAcos != null && baseline - postAcos >= FUNNEL_IMPROVEMENT_MIN_PP;
    if (!improved) {
      return [cut(input, "FUNNEL_FEEDBACK_NO_IMPROVEMENT", "HIGH", 88,
        `${input.label} foi otimizada ha ${input.lastAction.diasDesdeMudanca} dias e o ACOS pos-mudanca (${pct(postAcos)}) nao melhorou 10pp sobre o baseline (${pct(baseline)}). Reduzir R$0,05 nao resolveu — e gasto sem conserto barato.`,
        "Conversoes atribuidas tardiamente ainda podem entrar; o dado ja descontou os dias provisorios.")];
    }
  }

  // PASSO 1 — recencia: nao se pausa o que nao esta gastando.
  if (m7.cliques <= FUNNEL_DORMANT_MAX_CLICKS_7D) {
    if (acosAtLeast(m65, FUNNEL_PAUSE_ACOS_65D)) {
      return [cut(input, "FUNNEL_DORMANT_BAD_HISTORY", "HIGH", 85,
        `${input.label} esta dormente (sem cliques em 7d) e o ACOS de 65 dias (${pct(m65.acos)}) esta acima de 50%. Caso comprovadamente ruim — nao vale ressuscitar.`,
        "Se houve ruptura de estoque ou teste de listing no periodo, a pausa corta aprendizado.")];
    }
    if (input.currentBidCentavos != null) {
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
    if (improving) return EMPTY; // ficou eficiente — nao forca volume de volta
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
```

- [ ] **Step 2: Rodar os testes até passar**

Run: `npx vitest run src/modules/ads-optimizer/funnel.test.ts`
Expected: PASS (todos). Se algum falhar, ajustar a implementação (NUNCA afrouxar o teste — os casos-teste vêm do spec §10).

- [ ] **Step 3: Lint + typecheck**

Run: `npx tsc --noEmit && npx eslint src/modules/ads-optimizer/funnel.ts`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ads-optimizer/funnel.ts
git commit -m "feat(ads-optimizer): motor de decisao em funil stateful multi-janela (green)"
```

---

### Task 4: Service — snapshot 65d + memória de ações + integração do funil

**Files:**
- Modify: `src/modules/ads-optimizer/service.ts`

Mudanças cirúrgicas, na ordem do arquivo:

- [ ] **Step 1: Trocar imports do motor.** No topo do service.ts, remover o import de `./rules` (linhas 33–40) e adicionar:

```ts
import { deriveMetrics, emptyMetrics, type AdsOptimizerMetrics } from "./metrics";
import {
  evaluateAdsOptimizerFunnel,
  type AdsOptimizerActionType,
  type AdsOptimizerEntityType,
  type FunnelLastAction,
} from "./funnel";
import {
  FUNNEL_LONG_WINDOW_DAYS,
  FUNNEL_OBSERVATION_HIGH_CONFIDENCE_DAYS,
  FUNNEL_OBSERVATION_MIN_CLICKS,
  FUNNEL_OBSERVATION_MIN_DAYS,
  FUNNEL_PROVISIONAL_RECENT_DAYS,
} from "./funnel-params";
```

- [ ] **Step 2: Ator de sistema.** Logo após os tipos existentes (~linha 126), adicionar:

```ts
/** Quem disparou a rodada — sessao humana ou o worker automatico. */
export type OptimizerActor = { uid: string; email: string };

const SYSTEM_ACTOR: OptimizerActor = { uid: "system", email: "ads-optimizer@worker" };
```

- [ ] **Step 3: Refatorar `runOptimization` em core + wrapper.** Substituir o método `runOptimization(session)` por dois métodos no `adsOptimizerService` (o corpo atual de criação de run/loop/persistência vira `gerarRecomendacoes`):

```ts
  async runOptimization(session: SessionPayload) {
    return this.runCycle({ uid: session.uid, email: session.email });
  },

  /**
   * Ciclo completo: sync de entidades + relatorios (quota-aware) + recalculo.
   * Usado pela rota manual (com ator da sessao) e pelo worker (SYSTEM_ACTOR).
   */
  async runCycle(actor: OptimizerActor) {
    const creds = await requireAdsCredentials();
    const profileId = requireProfileId(creds);
    await syncEditableAdsEntities(creds);
    const reports = await syncOptimizerReportsWithCooldown(creds);
    if ("status" in reports && reports.status === "COOLDOWN") {
      return {
        status: "COOLDOWN",
        profileId,
        retryAt: reports.retryAt,
        operation: reports.operation,
        totalEntidades: 0,
        totalRecomendacoes: 0,
      };
    }
    const completedOrPendingReports =
      reports as Awaited<ReturnType<typeof syncOptimizerReports>>;
    const metricCounts = await countOptimizerMetrics(profileId);

    if (
      !reportsReady(completedOrPendingReports) &&
      metricCounts.targeting === 0 &&
      metricCounts.searchTerms === 0
    ) {
      return {
        status: "PENDING_REPORTS",
        profileId,
        reports: completedOrPendingReports,
        metricCounts,
        totalEntidades: 0,
        totalRecomendacoes: 0,
      };
    }

    return gerarRecomendacoes(profileId, actor);
  },
```

E criar a função module-level `gerarRecomendacoes` com o corpo que hoje vai de `const run = await db.adsOptimizationRun.create(...)` até o `return { runId... }`/`catch` (linhas ~180–288), com 3 mudanças:
  1. `iniciadoPorId: actor.uid, iniciadoPorEmail: actor.email` (em vez de session).
  2. A chamada `evaluateAdsOptimizerRules({...})` vira:

```ts
        const recommendations = evaluateAdsOptimizerFunnel({
          entityType: item.entity.entityType,
          entityId: item.entity.entityId,
          label: item.entity.label,
          keywordId: item.entity.keywordId,
          targetId: item.entity.targetId,
          searchTerm: item.entity.searchTerm,
          matchType: item.entity.matchType,
          estado: item.entity.estado,
          currentBidCentavos: item.entity.currentBidCentavos,
          metrics7d: item.metrics7d,
          metrics30d: item.metrics30d,
          metrics65d: item.metrics65d,
          metricsLifetime: item.metricsLifetime,
          lastAction: item.lastAction,
        });
```

  3. No `db.adsOptimizationRecommendation.create`, enriquecer a evidência para guardar a janela longa e o estado pós-mudança (sem migration): trocar `evidenceJson: json(buildRecommendationEvidence(item.entity, item.metricsPrev7d))` por

```ts
              evidenceJson: json({
                ...buildRecommendationEvidence(item.entity, item.metricsPrev7d),
                metrics65d: item.metrics65d,
                lastAction: item.lastAction
                  ? {
                      actionType: item.lastAction.actionType,
                      executadoEm: item.lastAction.executadoEm.toISOString(),
                      diasDesdeMudanca: item.lastAction.diasDesdeMudanca,
                      baselineAcos30d: item.lastAction.baselineAcos30d,
                      postChange: item.lastAction.postChange,
                    }
                  : null,
              }),
```

- [ ] **Step 4: Ampliar `buildOptimizationSnapshot`.** Dentro da função (~linha 1280):
  - Adicionar a janela longa junto das existentes: `const long65Start = addDays(today, -FUNNEL_LONG_WINDOW_DAYS);`
  - Buscar as ações aplicadas (depois do `Promise.all` existente):

```ts
  const appliedActions = await db.adsOptimizationRecommendation.findMany({
    where: { profileId, status: "APPLIED", executadoEm: { not: null } },
    orderBy: { executadoEm: "desc" },
    select: {
      entityType: true,
      entityId: true,
      actionType: true,
      executadoEm: true,
      metrics30dJson: true,
    },
    take: 2000,
  });
  const lastActionByEntity = new Map<string, (typeof appliedActions)[number]>();
  for (const action of appliedActions) {
    const key = `${action.entityType}:${action.entityId}`;
    if (!lastActionByEntity.has(key)) lastActionByEntity.set(key, action);
  }
```

  - No `return`, cada item ganha `metrics65d` e `lastAction`:

```ts
    items: allEntities.map((entity) => {
      const applied = lastActionByEntity.get(`${entity.entityType}:${entity.entityId}`);
      return {
        entity,
        metrics7d: aggregateMetrics(targetingRows, searchRows, entity, last7Start, today),
        metricsPrev7d: aggregateMetrics(targetingRows, searchRows, entity, prev7Start, prev7End),
        metrics30d: aggregateMetrics(targetingRows, searchRows, entity, last30Start, today),
        metrics65d: aggregateMetrics(targetingRows, searchRows, entity, long65Start, today),
        metricsLifetime: aggregateMetrics(targetingRows, searchRows, entity, null, null),
        lastAction: applied ? buildFunnelLastAction(applied, entity, targetingRows, searchRows, today) : null,
      };
    }),
```

  - Criar o helper module-level (perto de `aggregateMetrics`):

```ts
function buildFunnelLastAction(
  applied: {
    actionType: string;
    executadoEm: Date | null;
    metrics30dJson: string;
  },
  entity: OptimizerEntity,
  targetingRows: Parameters<typeof aggregateMetrics>[0],
  searchRows: Parameters<typeof aggregateMetrics>[1],
  today: Date,
): FunnelLastAction | null {
  if (!applied.executadoEm) return null;
  const inicio = startOfAdsDay(applied.executadoEm);
  const fimMaduro = addDays(today, -FUNNEL_PROVISIONAL_RECENT_DAYS);
  const baseline = parseOptionalJson<AdsOptimizerMetrics>(applied.metrics30dJson);
  return {
    actionType: applied.actionType,
    executadoEm: applied.executadoEm,
    diasDesdeMudanca: Math.max(0, differenceInCalendarDays(today, inicio)),
    baselineAcos30d: baseline?.acos ?? null,
    postChange: aggregateMetrics(targetingRows, searchRows, entity, inicio, fimMaduro),
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (o `service.test.ts` ainda não foi tocado — erros de TESTE aparecem na Task 5; erros de TIPO do service devem zerar aqui).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ads-optimizer/service.ts
git commit -m "feat(ads-optimizer): snapshot com janela 65d + memoria de acoes; funil integrado"
```

---

### Task 5: Service — observações no snapshot da UI + ciclo do worker + limpeza de obsoletas

**Files:**
- Modify: `src/modules/ads-optimizer/service.ts`
- Modify: `src/modules/ads-optimizer/service.test.ts`

- [ ] **Step 1: `getSnapshot` ganha `observations`.** Dentro do método `getSnapshot`, após montar `items`, adicionar:

```ts
    const observationCutoff = addDays(
      startOfAdsDay(new Date()),
      -FUNNEL_OBSERVATION_HIGH_CONFIDENCE_DAYS,
    );
    const observedRecs = profileId
      ? await db.adsOptimizationRecommendation.findMany({
          where: {
            profileId,
            status: "APPLIED",
            executadoEm: { gte: observationCutoff },
          },
          orderBy: { executadoEm: "desc" },
        })
      : [];
    const observations = await buildObservations(profileId, observedRecs);
```

E incluir `observations` no objeto retornado (junto de `recommendations`).

- [ ] **Step 2: Criar `buildObservations` module-level** (após `buildFunnelLastAction`):

```ts
/** Efeito diario acumulado das acoes aplicadas recentemente (spec §5.1). */
async function buildObservations(
  profileId: string,
  recs: Array<{
    id: string;
    entityType: string;
    entityId: string;
    actionType: string;
    sku: string | null;
    searchTerm: string | null;
    keywordId: string | null;
    targetId: string | null;
    campaignId: string;
    adGroupId: string | null;
    executadoEm: Date | null;
    metrics30dJson: string;
    evidenceJson: string;
  }>,
) {
  if (recs.length === 0) return [];
  const today = startOfAdsDay(new Date());
  const earliest = recs.reduce(
    (min, rec) => (rec.executadoEm && rec.executadoEm < min ? rec.executadoEm : min),
    today,
  );
  const [targetingRows, searchRows] = await Promise.all([
    db.amazonAdsTargetingMetricDaily.findMany({
      where: { profileId, data: { gte: startOfAdsDay(earliest) } },
    }),
    db.amazonAdsSearchTermMetricDaily.findMany({
      where: { profileId, data: { gte: startOfAdsDay(earliest) } },
    }),
  ]);

  return recs.flatMap((rec) => {
    if (!rec.executadoEm) return [];
    const evidence = parseOptionalJson<RecommendationEvidence>(rec.evidenceJson) ?? {};
    const entity = {
      entityType: rec.entityType as AdsOptimizerEntityType,
      entityId: rec.entityId,
      campaignId: rec.campaignId,
      adGroupId: rec.adGroupId,
      keywordId: rec.keywordId,
      targetId: rec.targetId,
      searchTerm: rec.searchTerm,
      matchType: evidence.matchType ?? null,
    } as OptimizerEntity;
    const inicio = startOfAdsDay(rec.executadoEm);
    const dias = Math.max(0, differenceInCalendarDays(today, inicio));
    const postChange = aggregateMetrics(targetingRows, searchRows, entity, inicio, today);
    const baseline = parseOptionalJson<AdsOptimizerMetrics>(rec.metrics30dJson);
    return [{
      recommendationId: rec.id,
      sku: rec.sku,
      displayLabel: evidence.displayLabel ?? evidence.label ?? rec.searchTerm ?? rec.entityId,
      actionType: rec.actionType,
      executadoEm: rec.executadoEm.toISOString(),
      diasDesdeMudanca: dias,
      cliquesPosMudanca: postChange.cliques,
      baselineAcos: baseline?.acos ?? null,
      postChange,
      madura:
        dias >= FUNNEL_OBSERVATION_MIN_DAYS &&
        postChange.cliques >= FUNNEL_OBSERVATION_MIN_CLICKS,
    }];
  });
}
```

(Obs.: o cast `as OptimizerEntity` é proposital — `aggregateMetrics` só usa os campos de identidade presentes; campos visuais ausentes não participam.)

- [ ] **Step 3: Ciclo do worker.** Adicionar ao `adsOptimizerService` (depois de `runCycle`):

```ts
  /**
   * Handler do job ADS_OPTIMIZER_CYCLE (worker, a cada ~6h).
   * Nunca depende de sessao. Alem do ciclo, avanca o backfill quando incompleto
   * e invalida APPROVED que ficaram obsoletas (usuario resolveu na mao).
   */
  async runWorkerCycle() {
    const creds = await getAmazonAdsCredentials({ requireProfile: true });
    if (!creds?.profileId) {
      return {
        ok: false,
        skipped: true,
        mensagem: "Amazon Ads nao configurado — ciclo do otimizador pulado.",
      };
    }
    const profileId = String(creds.profileId);

    const coverage = await getOptimizerCoverage(profileId);
    if (!coverage.backfill.complete) {
      await backfillOptimizerReportsWithCooldown(creds);
    }

    const cycle = await this.runCycle(SYSTEM_ACTOR);
    const invalidadas = await invalidateStaleApproved(profileId);
    return { ok: true, ...cycle, approvedInvalidadas: invalidadas };
  },
```

- [ ] **Step 4: Limpeza de APPROVED obsoletas.** Module-level, perto de `validateRecommendationFresh`:

```ts
/**
 * Recomendacoes APROVADAS cuja condicao mudou (lance alterado na mao, entidade
 * pausada, negativa ja criada) viram STALE — nunca aparecem obsoletas na tela.
 */
async function invalidateStaleApproved(profileId: string) {
  const approved = await db.adsOptimizationRecommendation.findMany({
    where: { profileId, status: "APPROVED" },
  });
  let total = 0;
  for (const rec of approved) {
    const reason = await validateRecommendationFresh(rec);
    if (reason) {
      await markRecommendationStale(rec.id, reason, SYSTEM_ACTOR);
      total += 1;
    }
  }
  return total;
}
```

- [ ] **Step 5: `markRecommendationStale` aceita o ator.** Trocar a assinatura (linha ~1863) de `session: SessionPayload` para `actor: OptimizerActor` e os usos internos `session.uid`/`session.email` para `actor.uid`/`actor.email`. Nos DOIS call sites existentes (`approveRecommendation` ~linha 532 e `executeRecommendation` ~linha 1758), trocar o argumento `session` por `{ uid: session.uid, email: session.email }`.

- [ ] **Step 6: Typecheck + ajustar `service.test.ts`.**

Run: `npx tsc --noEmit && npx vitest run src/modules/ads-optimizer/service.test.ts`

Os testes do service usam fixtures do motor velho. Mapeamento para corrigir expects que falharem:

| Cenário do teste (motor velho) | Resultado com o funil |
|---|---|
| keyword com `metrics30d` 25c/0v e 7d VAZIO | era `TARGET_25_CLICKS_ZERO_SALES`/PAUSE → agora **dormente**: `FUNNEL_DORMANT_REVIVE`/INCREASE_BID (se ACOS 65d < 50%) |
| keyword 25c/0v com cliques em 7d e sem vendas na vida | `FUNNEL_NO_SALES_CUT`/PAUSE_KEYWORD |
| search term 25c/0v | `FUNNEL_ST_NEGATE`/ADD_NEGATIVE_* |
| search term harvest (2 pedidos, ACOS ≤15%, broad) | `FUNNEL_ST_HARVEST`/CREATE_EXACT_KEYWORD (igual) |
| `HIGH_ACOS_TWO_WEEKS`, `ACOS_ABOVE_HEALTHY_REDUCE_BID`, `ACOS_LOW_INCREASE_BID` | não existem mais — cenário cai nos ramos do passo 3 (`FUNNEL_STABLE_WINNER`/`FUNNEL_RECENT_STRENGTH`/`FUNNEL_SPIKE_HIGH_BID`) ou em [] |

Para cada teste vermelho: identificar em qual ramo do funil a fixture cai (seguir a ordem passo 0→1→2→3) e atualizar `ruleId`/`actionType`/contagens esperadas. NÃO mudar fixtures para forçar o resultado antigo. Se um teste cobria comportamento que deixou de existir (ex.: pausa por 30d ignorando 7d), invertê-lo: assertar o comportamento NOVO (ex.: dormente → INCREASE_BID) — esses testes são justamente o valor da mudança.

Expected ao final: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ads-optimizer/service.ts src/modules/ads-optimizer/service.test.ts
git commit -m "feat(ads-optimizer): observacoes pos-mudanca no snapshot + ciclo do worker + limpeza de approved obsoletas"
```

---

### Task 6: Job automático (domain + schedule + worker)

**Files:**
- Modify: `src/modules/shared/domain.ts:218`
- Modify: `src/modules/amazon/jobs.ts:311-319`
- Modify: `src/modules/amazon/worker.ts:270-272,395-396`

- [ ] **Step 1: Novo tipo de job.** Em `domain.ts`, após a linha `WHATSAPP_ESTOQUE_RESUMO: "WHATSAPP_ESTOQUE_RESUMO",`:

```ts
  // Ciclo automatico do otimizador de Ads (funil): sync + recalculo + limpeza
  ADS_OPTIMIZER_CYCLE: "ADS_OPTIMIZER_CYCLE",
```

- [ ] **Step 2: Schedule 6h.** Em `jobs.ts`, dentro de `SCHEDULES`, após o bloco do `WHATSAPP_ESTOQUE_RESUMO` (~linha 318):

```ts
  // Otimizador de Ads (funil stateful): sincroniza relatorios proprios do
  // otimizador, recalcula recomendacoes e limpa obsoletas. Relatorio Amazon e
  // diario — 6h serve para manter o quadro limpo, nao para inventar dado novo.
  {
    tipo: TipoAmazonSyncJob.ADS_OPTIMIZER_CYCLE,
    intervalMs: 6 * 60 * 60_000,
    priority: 9,
  },
```

- [ ] **Step 3: Case no worker.** Em `worker.ts`:
  - Incluir o tipo na flag `isAdsJob` (linha ~270):

```ts
  const isAdsJob =
    tipo === TipoAmazonSyncJob.AMAZON_ADS_REPORT_SYNC ||
    tipo === TipoAmazonSyncJob.AMAZON_ADS_BACKFILL ||
    tipo === TipoAmazonSyncJob.ADS_OPTIMIZER_CYCLE;
```

  - Adicionar o case antes do `default:` (~linha 397) — `runWorkerCycle` resolve as próprias credenciais e retorna `skipped` quando não configurado:

```ts
    case TipoAmazonSyncJob.ADS_OPTIMIZER_CYCLE:
      return adsOptimizerService.runWorkerCycle();
```

  - Adicionar o import no topo do worker.ts:

```ts
import { adsOptimizerService } from "@/modules/ads-optimizer/service";
```

- [ ] **Step 4: Validar**

Run: `npx tsc --noEmit && npx eslint src/modules/amazon/worker.ts src/modules/amazon/jobs.ts src/modules/shared/domain.ts`
Expected: sem erros.

Run: `npx vitest run src/modules/ads-optimizer`
Expected: PASS (suite do módulo intacta).

- [ ] **Step 5: Commit**

```bash
git add src/modules/shared/domain.ts src/modules/amazon/jobs.ts src/modules/amazon/worker.ts
git commit -m "feat(ads-optimizer): job ADS_OPTIMIZER_CYCLE a cada 6h no worker"
```

---

### Task 7: UI — tela limpa + painel "Em observação"

**Files:**
- Modify: `src/app/publicidade/otimizador/page.tsx`

- [ ] **Step 1: Remover componentes de "engrenagem".** Deletar do arquivo:
  - Componentes `CoveragePanel`, `CoverageTile`, `BackfillBadge`, `SummaryCard` e o helper `summarySub` (linhas ~613–826 na versão atual).
  - Tipos `ReportWindow`, `BackfillReportResult`, `OptimizerCoverage`, `MetricCoverage`, `BackfillState`, `BackfillResult` — EXCETO: manter `OptimizerCoverage`/`MetricCoverage`/`BackfillState` se o `Snapshot` type continuar tipando `coverage` (o service segue retornando; a UI só ignora). Decisão simples: trocar no tipo `Snapshot` o campo `coverage: OptimizerCoverage | null` por `coverage: unknown` e deletar TODOS os seis tipos.
  - `backfillMutation` inteiro e o botão "Buscar historico" do `PageHeader`.
  - O `<CoveragePanel ... />` e o grid `<div className="grid gap-3 md:grid-cols-4">` com os 4 `SummaryCard`.
  - As variáveis que ficarem órfãs: `pendingGroupCount`, `approvedGroupCount`, `blockedPendingCount`, `blockedPending`, `coverage`, e o uso de `historyLabel` baseado em coverage → trocar por constante: `const historyLabel = "Historico disponivel";`

- [ ] **Step 2: Botão único de atualização.** No `PageHeader`, deixar apenas:

```tsx
        <Button
          variant="ghost"
          size="sm"
          onClick={() => runMutation.mutate()}
          disabled={isBusy}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", runMutation.isPending && "animate-spin")} />
          Atualizar agora
        </Button>
        <Button
          size="sm"
          onClick={() => executeMutation.mutate()}
          disabled={isBusy || executableApproved === 0}
        >
          <Play className="mr-2 h-4 w-4" />
          Executar aprovadas
        </Button>
```

E atualizar `isBusy` removendo `backfillMutation.isPending`.

- [ ] **Step 3: Tipo e painel de observações.** Adicionar o tipo (junto dos outros):

```tsx
type Observation = {
  recommendationId: string;
  sku: string | null;
  displayLabel: string;
  actionType: string;
  executadoEm: string;
  diasDesdeMudanca: number;
  cliquesPosMudanca: number;
  baselineAcos: number | null;
  postChange: OptimizerMetrics;
  madura: boolean;
};
```

No tipo `Snapshot`, adicionar `observations: Observation[];`.

Criar o componente (no lugar onde ficava o CoveragePanel):

```tsx
function ObservationPanel({ observations }: { observations: Observation[] }) {
  if (observations.length === 0) return null;
  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardContent className="space-y-3 pt-5">
        <div>
          <p className="text-sm font-semibold">Em observação</p>
          <p className="text-sm text-muted-foreground">
            Ações aplicadas recentemente. O sistema acompanha o efeito dia a dia e
            só decide o próximo passo com dado maduro (7+ dias e 10+ cliques).
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {observations.map((obs) => (
            <div key={obs.recommendationId} className="rounded-md border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{obs.displayLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {obs.sku ? `${obs.sku} | ` : ""}
                    {ACTION_LABEL[obs.actionType] ?? obs.actionType} ·{" "}
                    {plural(obs.diasDesdeMudanca, "dia", "dias")} desde a mudança
                  </p>
                </div>
                <Badge variant="outline" className={obs.madura ? "border-emerald-300 text-emerald-700" : "border-blue-300 text-blue-700"}>
                  {obs.madura ? "Dado maduro" : "Provisório"}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                <Fact label="Gasto desde" value={formatBRL(obs.postChange.gastoCentavos)} />
                <Fact label="Vendas desde" value={formatBRL(obs.postChange.vendasCentavos)} />
                <Fact label="Cliques" value={String(obs.cliquesPosMudanca)} />
                <Fact
                  label="ACOS antes → agora"
                  value={`${formatPct(obs.baselineAcos)} → ${formatPct(obs.postChange.acos)}`}
                />
              </div>
              {!obs.madura && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Conversões da Amazon ainda entrando (janela de atribuição de 7 dias).
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

Renderizar no corpo principal, onde estava o `<CoveragePanel ...>`:

```tsx
      <ObservationPanel observations={query.data?.observations ?? []} />
```

- [ ] **Step 4: EmptyState honesto com a automação.** Trocar o texto do `EmptyState`:

```tsx
        <p className="mt-1 text-sm text-muted-foreground">
          {hasData
            ? "Ajuste os filtros para ver outras ações."
            : "O ciclo automático roda a cada 6 horas. Quando houver algo a decidir, aparece aqui."}
        </p>
```

(E manter a primeira linha: `hasData ? "Nenhuma acao nos filtros atuais." : "Nenhuma ação pendente — tudo otimizado."`)

- [ ] **Step 5: Validar**

Run: `npx tsc --noEmit && npx eslint src/app/publicidade/otimizador/page.tsx`
Expected: sem erros (atenção a imports órfãos: `History`, `CalendarClock`, `Layers3` podem ficar sem uso — remover os que o eslint apontar).

- [ ] **Step 6: Commit**

```bash
git add src/app/publicidade/otimizador/page.tsx
git commit -m "feat(ads-optimizer): UI limpa (sem coverage/contadores) + painel Em observacao"
```

---

### Task 8: Aposentar o motor antigo + validação final + docs

**Files:**
- Delete: `src/modules/ads-optimizer/rules.ts`
- Delete: `src/modules/ads-optimizer/rules.test.ts`
- Modify: `CLAUDE.md` (seção "Ads (fonte única)" — bullet do Otimizador)

- [ ] **Step 1: Conferir que nada mais importa o motor velho**

Run: `grep -rn "from \"./rules\"\|from \"@/modules/ads-optimizer/rules\"" src/`
Expected: nenhuma ocorrência fora de `rules.ts`/`rules.test.ts`. Se aparecer (ex.: `tenant-isolation.test.ts`), trocar o import para `./metrics`/`./funnel` conforme o símbolo.

- [ ] **Step 2: Deletar**

```bash
git rm src/modules/ads-optimizer/rules.ts src/modules/ads-optimizer/rules.test.ts
```

- [ ] **Step 3: Suite completa do módulo + typecheck**

Run: `npx tsc --noEmit && npx vitest run src/modules/ads-optimizer`
Expected: PASS em funnel.test.ts, service.test.ts, sku-attribution.test.ts, tenant-isolation.test.ts.

- [ ] **Step 4: Atualizar CLAUDE.md.** Na seção "### Ads (fonte única)", substituir o bullet do Otimizador por:

```markdown
- **Otimizador** (`/publicidade/otimizador`, `src/modules/ads-optimizer/`): motor de decisão em **funil stateful** (`funnel.ts`, parâmetros em `funnel-params.ts`) — recência 7d → conversão (25 cliques/0 venda, vetado por ACOS de vida <15%) → multi-janela 7/30/65d (sobe lance <15% nas 3; segura "bom momento" 7d ótimo + 30d >25%) → feedback pós-mudança (corta se não melhorou ≥10pp após ≥7d e ≥10 cliques, descontando 2 dias provisórios). Job `ADS_OPTIMIZER_CYCLE` (6h) sincroniza relatórios próprios do otimizador, recalcula, avança backfill e invalida APPROVED obsoletas (`runWorkerCycle`). Aprovação/execução continuam humanas. UI sem coverage/contadores; painel "Em observação" mostra efeito acumulado desde cada ação aplicada. Histórico por SKU via `GET /api/ads/optimizer/history?sku=`.
```

E na tabela de Schedules do CLAUDE.md, adicionar a linha:

```markdown
| ADS_OPTIMIZER_CYCLE | 6h | funil do otimizador: sync relatórios próprios + recalculo + limpeza de obsoletas |
```

- [ ] **Step 5: Lint nos arquivos tocados na entrega inteira**

Run: `npx eslint src/modules/ads-optimizer/ src/modules/amazon/worker.ts src/modules/amazon/jobs.ts src/app/publicidade/otimizador/page.tsx`
Expected: sem erros.

- [ ] **Step 6: Commit final**

```bash
git add CLAUDE.md
git commit -m "feat(ads-optimizer): aposenta motor de regras antigo; docs do funil"
```

---

## Verificação de aceitação (manual, pós-implementação)

1. `npx vitest run src/modules/ads-optimizer` — verde.
2. Subir `npm run dev` e abrir `/publicidade/otimizador`: sem CoveragePanel, sem 4 cards; painel "Em observação" aparece se houver ação APPLIED nos últimos 14 dias.
3. Worker local (`npm run dev` já o sobe): confirmar no log que `ADS_OPTIMIZER_CYCLE` é enfileirado e processado sem erro (ou `skipped` se Ads não configurado no ambiente local).
4. Casos-teste do spec §10 estão cobertos 1:1 em `funnel.test.ts` (1=almofada dormente, 2=lance alto, 3=sem salvação, 4=eficiência, 5=vencedora, 6=bom momento, 7=feedback negativo).

## Notas de execução

- **Nunca rodar `npm run build`** sem pedido explícito; validação é tsc/eslint/vitest dirigidos.
- **Nenhuma migration**: confirmado — nada novo em `prisma/schema.prisma`; 65d/lastAction viajam em `evidenceJson` e em memória.
- **Recomendações antigas do motor velho**: o primeiro `gerarRecomendacoes` já marca todas as PROPOSED como STALE (comportamento existente) — migração automática.
- **Trade-off aceito (spec §6)**: sem follow-up de report dentro do ciclo; um report criado num ciclo é baixado no ciclo seguinte (6h). Julgamentos usam ≥7 dias, então isso não muda decisão.
