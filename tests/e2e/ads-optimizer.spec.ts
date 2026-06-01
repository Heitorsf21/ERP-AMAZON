import crypto from "node:crypto";
import { expect, test } from "@playwright/test";

const sessionSecret =
  process.env.SESSION_SECRET ??
  "playwright-session-secret-0123456789abcdef0123456789abcdef";
const baseURL = `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3107}`;

test("otimizador permite revisar por SKU, editar lance e aprovar sem Amazon real", async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: "erp_session",
      value: signSession({
        uid: "user-e2e",
        email: "e2e@atlas.test",
        nome: "E2E Admin",
        role: "ADMIN",
        exp: Math.floor(Date.now() / 1000) + 3600,
        v: 0,
        empresaId: "empresa-e2e",
      }),
      url: baseURL,
      sameSite: "Lax",
      httpOnly: true,
    },
  ]);

  let approvedBidCentavos: number | null = null;
  let executeCalled = false;
  let snapshotCalls = 0;

  await context.route("**/api/ads/optimizer/snapshot**", async (route) => {
    snapshotCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshot(approvedBidCentavos)),
    });
  });

  await context.route(
    "**/api/ads/optimizer/recommendations/rec-bid/approve**",
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        bidCentavos?: number;
      };
      approvedBidCentavos = body.bidCentavos ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    },
  );

  await context.route("**/api/ads/optimizer/execute-approved**", async (route) => {
    executeCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total: 1,
        applied: 0,
        dryRun: 1,
        failed: 0,
        stale: 0,
        results: [{ id: "rec-bid", status: "DRY_RUN" }],
      }),
    });
  });

  await page.goto("/publicidade/otimizador");

  await expect(
    page.getByRole("heading", { name: "Otimizador de Ads" }),
  ).toBeVisible();
  await expect.poll(() => snapshotCalls).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "BOLSA-TERMICA-01" })).toBeVisible();
  await expect(page.getByText("1 critica")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SEARCH_TERM");
  await expect(page.locator("body")).not.toContainText("ACOS_LOW_INCREASE_BID");

  await page.getByRole("tab", { name: /Oportunidades de termos/ }).click();
  await expect(page.getByText("bolsa termica premium")).toBeVisible();
  await expect(page.getByText("Termo pesquisado", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Ajustes existentes/ }).click();
  await page.getByRole("button", { name: "Detalhes" }).first().click();
  await expect(page.getByText("ACOS_LOW_INCREASE_BID")).toBeVisible();
  await expect(page.getByText("Risco operacional")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Tipo campanha").selectOption("manual");
  await page.getByLabel("Tipo", { exact: true }).selectOption("KEYWORD");

  await page.getByLabel("Meu lance final para aprovar").fill("1,02");
  await page.getByRole("button", { name: "Aprovar ajuste" }).click();

  await expect.poll(() => approvedBidCentavos).toBe(102);
  await expect(page.getByText("Proposta original")).toBeVisible();
  await expect(page.getByText("Aprovado para executar")).toBeVisible();
  await expect(page.getByText("Lance R$ 1,02")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Executar aprovadas" })).toBeEnabled();

  await page.getByRole("button", { name: "Executar aprovadas" }).click();

  await expect.poll(() => executeCalled).toBe(true);
  await expect(
    page.getByText("1 simulacao, nenhuma alteracao enviada para Amazon"),
  ).toBeVisible();
});

function snapshot(approvedBidCentavos: number | null) {
  const isApproved = approvedBidCentavos != null;
  return {
    profileId: "profile-e2e",
    lastRun: {
      id: "run-e2e",
      status: "DONE",
      iniciadoEm: "2026-06-01T10:00:00.000Z",
      finalizadoEm: "2026-06-01T10:01:00.000Z",
      totalEntidades: 3,
      totalRecomendacoes: 3,
      erro: null,
    },
    totals: {
      proposed: isApproved ? 2 : 3,
      approved: isApproved ? 1 : 0,
      failed: 0,
      stale: 0,
    },
    coverage: {
      earliestAvailable: "2026-02-26",
      latestClosed: "2026-05-31",
      expectedDays: 95,
      historyStartDate: "2026-02-26",
      historyEndDate: "2026-05-31",
      targeting: {
        minDate: "2026-02-26",
        maxDate: "2026-05-31",
        rows: 10,
        daysWithData: 95,
        expectedDays: 95,
      },
      searchTerms: {
        minDate: "2026-03-28",
        maxDate: "2026-05-31",
        rows: 5,
        daysWithData: 65,
        expectedDays: 95,
      },
      backfill: {
        targeting: {
          status: "COMPLETE",
          pendingId: null,
          window: null,
          cursor: "2026-06-01T00:00:00.000Z",
          progressPct: 100,
          lastCompletedAt: "2026-06-01T10:00:00.000Z",
        },
        searchTerms: {
          status: "COMPLETE",
          pendingId: null,
          window: null,
          cursor: "2026-06-01T00:00:00.000Z",
          progressPct: 100,
          lastCompletedAt: "2026-06-01T10:00:00.000Z",
        },
        pending: false,
        complete: true,
      },
    },
    recommendations: [
      recommendation({
        id: "rec-bid",
        status: isApproved ? "APPROVED" : "PROPOSED",
        actionType: "INCREASE_BID",
        severity: "LOW",
        ruleId: "ACOS_LOW_INCREASE_BID",
        label: "bolsa termica",
        motivo:
          "Keyword com ACOS saudavel em 7d e 30d. Aumentar lance pode capturar mais volume.",
        risco: "Pode elevar CPC; revisar na proxima janela.",
        currentBidCentavos: 90,
        proposedBidCentavos: 95,
        approvedBidCentavos,
        metrics30d: healthyMetrics,
      }),
      recommendation({
        id: "rec-pause",
        status: "PROPOSED",
        actionType: "PAUSE_KEYWORD",
        severity: "CRITICAL",
        ruleId: "TARGET_25_CLICKS_ZERO_SALES",
        label: "bolsa termica grande barata",
        motivo:
          "Keyword teve 31 cliques em 30 dias e nenhuma venda. Pausar interrompe gasto improdutivo.",
        risco: "Se houve ruptura, a pausa pode cortar aprendizado.",
        currentBidCentavos: 85,
        proposedBidCentavos: null,
        approvedBidCentavos: null,
        proposedState: "paused",
        metrics30d: wasteMetrics,
      }),
      recommendation({
        id: "rec-search-term",
        entityType: "SEARCH_TERM",
        displayEntityType: "Termo pesquisado",
        entityId: "SEARCH_TERM:campaign-e2e:ad-group-e2e:kw:e2e",
        keywordId: "keyword-e2e",
        searchTerm: "bolsa termica premium",
        displayLabel: "bolsa termica premium",
        label: "bolsa termica premium",
        actionType: "CREATE_EXACT_KEYWORD",
        severity: "LOW",
        ruleId: "SEARCH_TERM_GOOD_HARVEST_EXACT",
        motivo:
          "Termo pesquisado converteu com ACOS baixo em 30 dias. Criar exact permite controlar o lance.",
        risco: "Pode duplicar trafego se a campanha original continuar capturando o termo.",
        currentBidCentavos: 90,
        proposedBidCentavos: 95,
        approvedBidCentavos: null,
        metrics30d: healthyMetrics,
      }),
    ],
  };
}

function recommendation(overrides: Record<string, unknown>) {
  return { ...baseRecommendation(), ...overrides };
}

function baseRecommendation(): Record<string, unknown> {
  return {
    id: "rec",
    status: "PROPOSED",
    entityType: "KEYWORD",
    displayEntityType: "Palavra-chave",
    entityId: "keyword-e2e",
    label: "keyword",
    displayLabel: "keyword",
    campaignId: "campaign-e2e",
    campaignName: "SP Manual | Bolsa termica",
    campaignTargetingType: "manual",
    portfolioId: null,
    portfolioName: null,
    adGroupId: "ad-group-e2e",
    adGroupName: "Grupo principal",
    keywordId: "keyword-e2e",
    targetId: null,
    searchTerm: null,
    sku: "BOLSA-TERMICA-01",
    asin: "B0SAMPLE01",
    skuAttributionStatus: "RESOLVED",
    skuAttributionSource: "SINGLE_ACTIVE_PRODUCT_AD",
    isExecutable: true,
    blockedReason: null,
    actionType: "INCREASE_BID",
    severity: "LOW",
    ruleId: "RULE",
    motivo: "Motivo",
    risco: "Risco",
    confianca: 80,
    currentBidCentavos: 90,
    proposedBidCentavos: 95,
    approvedBidCentavos: null,
    beforeState: "enabled",
    proposedState: null,
    metrics7d: healthyMetrics,
    metrics30d: healthyMetrics,
    metricsLifetime: healthyMetrics,
    criadoEm: "2026-06-01T10:00:00.000Z",
    aprovadoEm: null,
    executadoEm: null,
    staleReason: null,
    errorMessage: null,
  };
}

const healthyMetrics = {
  impressoes: 1500,
  cliques: 42,
  gastoCentavos: 1880,
  vendasCentavos: 18000,
  pedidos: 4,
  unidades: 4,
  acos: 1880 / 18000,
  roas: 18000 / 1880,
  ctr: 42 / 1500,
  cpcCentavos: 45,
  conversao: 4 / 42,
};

const wasteMetrics = {
  impressoes: 2100,
  cliques: 31,
  gastoCentavos: 2650,
  vendasCentavos: 0,
  pedidos: 0,
  unidades: 0,
  acos: null,
  roas: 0,
  ctr: 31 / 2100,
  cpcCentavos: 85,
  conversao: 0,
};

function signSession(payload: Record<string, unknown>) {
  const payloadJson = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payloadJson)
    .digest();
  return `${base64Url(Buffer.from(payloadJson))}.${base64Url(signature)}`;
}

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
