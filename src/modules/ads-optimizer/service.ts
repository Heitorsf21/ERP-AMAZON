import { addDays, differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import { isAmazonQuotaCooldownError } from "@/lib/amazon-rate-limit";
import {
  createSpSearchTermReport,
  createSpTargetingReport,
  createSponsoredProductsKeywords,
  createSponsoredProductsNegativeKeywords,
  createSponsoredProductsNegativeTargets,
  downloadAdsReportRows,
  getAdsReport,
  listAdsPortfolios,
  listSponsoredProductsCampaigns,
  listSponsoredProductsAdGroups,
  listSponsoredProductsKeywords,
  listSponsoredProductsNegativeKeywords,
  listSponsoredProductsNegativeTargets,
  listSponsoredProductsProductAds,
  listSponsoredProductsTargets,
  updateSponsoredProductsKeywords,
  updateSponsoredProductsTargets,
  type AdsAPICredentials,
  type AdsReportRow,
} from "@/lib/amazon-ads-api";
import { getAmazonAdsCredentials } from "@/modules/amazon/ads-service";
import {
  parseSpSearchTermRows,
  parseSpTargetingRows,
  type AdsOptimizerMetricRow,
  type AdsOptimizerSearchTermRow,
} from "@/modules/amazon/parsers/sp-optimizer-reports";
import type { SessionPayload } from "@/lib/session";
import {
  deriveMetrics,
  emptyMetrics,
  evaluateAdsOptimizerRules,
  type AdsOptimizerEntityType,
  type AdsOptimizerMetrics,
} from "./rules";

const ACTIVE_STATES = new Set(["enabled"]);
const MAX_PAGES = 50;
const DEFAULT_REPORT_DAYS = 30;
const REPORT_RETENTION_DAYS = 95;
const BACKFILL_WINDOW_DAYS = 30;

type JsonRecord = Record<string, unknown>;

type OptimizerEntity = {
  entityType: AdsOptimizerEntityType;
  entityId: string;
  label: string;
  campaignId: string;
  campaignName: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  keywordId: string | null;
  targetId: string | null;
  searchTerm: string | null;
  matchType: string | null;
  estado: string | null;
  currentBidCentavos: number | null;
  sku: string | null;
  asin: string | null;
};

type MetricAccumulator = {
  impressoes: number;
  cliques: number;
  gastoCentavos: number;
  vendasCentavos: number;
  pedidos: number;
  unidades: number;
};

export const adsOptimizerService = {
  async syncBaseData() {
    const creds = await requireAdsCredentials();
    const [entities, reports] = await Promise.all([
      syncEditableAdsEntities(creds),
      syncOptimizerReports(creds),
    ]);
    return { entities, reports };
  },

  async backfillHistory() {
    const creds = await requireAdsCredentials();
    const profileId = requireProfileId(creds);
    const reports = await backfillOptimizerReportsWithCooldown(creds);
    const coverage = await getOptimizerCoverage(profileId);
    return { profileId, reports, coverage };
  },

  async runOptimization(session: SessionPayload) {
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

    const run = await db.adsOptimizationRun.create({
      data: {
        profileId,
        iniciadoPorId: session.uid,
        iniciadoPorEmail: session.email,
        payloadJson: json({ triggeredBy: "manual" }),
      },
    });

    try {
      await db.adsOptimizationRecommendation.updateMany({
        where: { profileId, status: "PROPOSED" },
        data: { status: "STALE", staleReason: "Nova rodada de otimização gerada" },
      });

      const snapshot = await buildOptimizationSnapshot(profileId);
      let total = 0;

      for (const item of snapshot.items) {
        const recommendations = evaluateAdsOptimizerRules({
          entityType: item.entity.entityType,
          entityId: item.entity.entityId,
          label: item.entity.label,
          campaignId: item.entity.campaignId,
          adGroupId: item.entity.adGroupId,
          keywordId: item.entity.keywordId,
          targetId: item.entity.targetId,
          searchTerm: item.entity.searchTerm,
          matchType: item.entity.matchType,
          estado: item.entity.estado,
          currentBidCentavos: item.entity.currentBidCentavos,
          metrics7d: item.metrics7d,
          metricsPrev7d: item.metricsPrev7d,
          metrics30d: item.metrics30d,
          metricsLifetime: item.metricsLifetime,
        });

        for (const rec of recommendations) {
          await db.adsOptimizationRecommendation.create({
            data: {
              runId: run.id,
              profileId,
              entityType: item.entity.entityType,
              entityId: item.entity.entityId,
              campaignId: item.entity.campaignId,
              campaignName: item.entity.campaignName,
              portfolioId: item.entity.portfolioId,
              portfolioName: item.entity.portfolioName,
              adGroupId: item.entity.adGroupId,
              adGroupName: item.entity.adGroupName,
              keywordId: item.entity.keywordId,
              targetId: item.entity.targetId,
              searchTerm: item.entity.searchTerm,
              sku: item.entity.sku,
              asin: item.entity.asin,
              actionType: rec.actionType,
              severity: rec.severity,
              ruleId: rec.ruleId,
              motivo: rec.motivo,
              risco: rec.risco,
              confianca: rec.confianca,
              currentBidCentavos: item.entity.currentBidCentavos,
              proposedBidCentavos: rec.proposedBidCentavos,
              beforeState: item.entity.estado,
              proposedState: rec.proposedState,
              metrics7dJson: json(item.metrics7d),
              metrics30dJson: json(item.metrics30d),
              metricsLifetimeJson: json(item.metricsLifetime),
              evidenceJson: json({
                metricsPrev7d: item.metricsPrev7d,
                label: item.entity.label,
              }),
            },
          });
          total += 1;
        }
      }

      await db.adsOptimizationRun.update({
        where: { id: run.id },
        data: {
          status: "DONE",
          finalizadoEm: new Date(),
          totalEntidades: snapshot.items.length,
          totalRecomendacoes: total,
        },
      });

      return { runId: run.id, totalEntidades: snapshot.items.length, totalRecomendacoes: total };
    } catch (error) {
      await db.adsOptimizationRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          finalizadoEm: new Date(),
          erro: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  },

  async getSnapshot() {
    const creds = await getAmazonAdsCredentials();
    const profileId = creds?.profileId ?? "";
    const [recommendations, lastRun, coverage] = await Promise.all([
      db.adsOptimizationRecommendation.findMany({
        where: profileId
          ? { profileId, status: { in: ["PROPOSED", "APPROVED", "FAILED", "STALE"] } }
          : { status: { in: ["PROPOSED", "APPROVED", "FAILED", "STALE"] } },
        orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
        take: 300,
      }),
      db.adsOptimizationRun.findFirst({
        where: profileId ? { profileId } : {},
        orderBy: { iniciadoEm: "desc" },
      }),
      profileId ? getOptimizerCoverage(profileId) : Promise.resolve(null),
    ]);

    const items = recommendations.map((rec) => {
      const evidence = parseJson<{ label?: string }>(rec.evidenceJson);
      return {
        id: rec.id,
        status: rec.status,
        entityType: rec.entityType,
        entityId: rec.entityId,
        label: evidence.label ?? rec.searchTerm ?? rec.entityId,
        campaignId: rec.campaignId,
        campaignName: rec.campaignName,
        portfolioId: rec.portfolioId,
        portfolioName: rec.portfolioName,
        adGroupId: rec.adGroupId,
        adGroupName: rec.adGroupName,
        keywordId: rec.keywordId,
        targetId: rec.targetId,
        searchTerm: rec.searchTerm,
        sku: rec.sku,
        asin: rec.asin,
        actionType: rec.actionType,
        severity: rec.severity,
        ruleId: rec.ruleId,
        motivo: rec.motivo,
        risco: rec.risco,
        confianca: rec.confianca,
        currentBidCentavos: rec.currentBidCentavos,
        proposedBidCentavos: rec.proposedBidCentavos,
        beforeState: rec.beforeState,
        proposedState: rec.proposedState,
        metrics7d: parseJson<AdsOptimizerMetrics>(rec.metrics7dJson),
        metrics30d: parseJson<AdsOptimizerMetrics>(rec.metrics30dJson),
        metricsLifetime: parseJson<AdsOptimizerMetrics>(rec.metricsLifetimeJson),
        criadoEm: rec.criadoEm.toISOString(),
        aprovadoEm: rec.aprovadoEm?.toISOString() ?? null,
        executadoEm: rec.executadoEm?.toISOString() ?? null,
        staleReason: rec.staleReason,
        errorMessage: rec.errorMessage,
      };
    });

    return {
      profileId,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            iniciadoEm: lastRun.iniciadoEm.toISOString(),
            finalizadoEm: lastRun.finalizadoEm?.toISOString() ?? null,
            totalEntidades: lastRun.totalEntidades,
            totalRecomendacoes: lastRun.totalRecomendacoes,
            erro: lastRun.erro,
          }
        : null,
      totals: {
        proposed: items.filter((r) => r.status === "PROPOSED").length,
        approved: items.filter((r) => r.status === "APPROVED").length,
        failed: items.filter((r) => r.status === "FAILED").length,
        stale: items.filter((r) => r.status === "STALE").length,
      },
      coverage,
      recommendations: items,
    };
  },

  async approveRecommendation(id: string, session: SessionPayload) {
    const rec = await db.adsOptimizationRecommendation.findFirst({ where: { id } });
    if (!rec) throw new Error("recomendação não encontrada");
    if (rec.status !== "PROPOSED") {
      throw new Error(`recomendação não está pendente: ${rec.status}`);
    }
    return db.adsOptimizationRecommendation.update({
      where: { id: rec.id },
      data: {
        status: "APPROVED",
        aprovadoPorId: session.uid,
        aprovadoPorEmail: session.email,
        aprovadoEm: new Date(),
      },
    });
  },

  async rejectRecommendation(id: string, session: SessionPayload) {
    const rec = await db.adsOptimizationRecommendation.findFirst({ where: { id } });
    if (!rec) throw new Error("recomendação não encontrada");
    if (!["PROPOSED", "APPROVED"].includes(rec.status)) {
      throw new Error(`recomendação não pode ser rejeitada: ${rec.status}`);
    }
    return db.adsOptimizationRecommendation.update({
      where: { id: rec.id },
      data: {
        status: "REJECTED",
        rejeitadoPorId: session.uid,
        rejeitadoPorEmail: session.email,
        rejeitadoEm: new Date(),
      },
    });
  },

  async executeApproved(session: SessionPayload) {
    const creds = await requireAdsCredentials();
    await syncEditableAdsEntities(creds);

    const approved = await db.adsOptimizationRecommendation.findMany({
      where: { profileId: requireProfileId(creds), status: "APPROVED" },
      orderBy: { aprovadoEm: "asc" },
      take: 50,
    });

    const results = [];
    for (const rec of approved) {
      results.push(await executeRecommendation(creds, rec, session));
    }
    return {
      total: results.length,
      applied: results.filter((r) => r.status === "APPLIED").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      stale: results.filter((r) => r.status === "STALE").length,
      results,
    };
  },
};

async function requireAdsCredentials() {
  const creds = await getAmazonAdsCredentials();
  if (!creds?.profileId) {
    throw new Error("Amazon Ads não está configurado com profileId");
  }
  return creds;
}

function requireProfileId(creds: AdsAPICredentials) {
  if (!creds.profileId) throw new Error("profileId ausente");
  return String(creds.profileId);
}

async function syncEditableAdsEntities(creds: AdsAPICredentials) {
  const profileId = requireProfileId(creds);
  const now = new Date();
  const [
    portfolios,
    campaigns,
    adGroups,
    productAds,
    keywords,
    targets,
    negativeKeywords,
    negativeTargets,
  ] =
    await Promise.all([
      collectPages((nextToken) =>
        listAdsPortfolios(creds, { nextToken, maxResults: 100 }),
      "portfolios"),
      collectPages((nextToken) =>
        listSponsoredProductsCampaigns(creds, { nextToken, maxResults: 100 }),
      "campaigns"),
      collectPages((nextToken) =>
        listSponsoredProductsAdGroups(creds, { nextToken, maxResults: 100 }),
      "adGroups"),
      collectPages((nextToken) =>
        listSponsoredProductsProductAds(creds, { nextToken, maxResults: 100 }),
      "productAds"),
      collectPages((nextToken) =>
        listSponsoredProductsKeywords(creds, { nextToken, maxResults: 100 }),
      "keywords"),
      collectPages((nextToken) =>
        listSponsoredProductsTargets(creds, { nextToken, maxResults: 100 }),
      "targets"),
      collectPages((nextToken) =>
        listSponsoredProductsNegativeKeywords(creds, { nextToken, maxResults: 100 }),
      "negativeKeywords"),
      collectPages((nextToken) =>
        listSponsoredProductsNegativeTargets(creds, { nextToken, maxResults: 100 }),
      "negativeTargets"),
    ]);

  const portfolioById = new Map<string, { id: string; nome: string | null }>();
  for (const row of portfolios) {
    const portfolioId = idString(row.portfolioId);
    if (!portfolioId) continue;
    const nome = stringOrNull(row.name) ?? portfolioId;
    portfolioById.set(portfolioId, { id: portfolioId, nome });
    await upsertFirst("amazonAdsPortfolio", { profileId, portfolioId }, {
      profileId,
      portfolioId,
      nome,
      estado: stringOrNull(row.state),
      budgetCentavos: moneyToCentavos((row.budget as JsonRecord | undefined)?.amount ?? (row.budget as JsonRecord | undefined)?.budget),
      budgetPolicy: stringOrNull((row.budget as JsonRecord | undefined)?.policy),
      currencyCode: stringOrNull((row.budget as JsonRecord | undefined)?.currencyCode),
      inBudget: typeof row.inBudget === "boolean" ? row.inBudget : null,
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  const campaignById = new Map<string, { nome: string; portfolioId: string | null; portfolioName: string | null }>();
  for (const row of campaigns) {
    const campaignId = idString(row.campaignId);
    if (!campaignId) continue;
    const portfolioId = idString(row.portfolioId);
    const portfolioName = portfolioId ? portfolioById.get(portfolioId)?.nome ?? null : null;
    const nome = stringOrNull(row.name) ?? campaignId;
    campaignById.set(campaignId, { nome, portfolioId, portfolioName });
    await upsertFirst("amazonAdsCampaignEntity", { profileId, campaignId }, {
      profileId,
      campaignId,
      portfolioId,
      nome,
      estado: stringOrNull(row.state),
      targetingType: stringOrNull(row.targetingType),
      budgetCentavos: moneyToCentavos((row.budget as JsonRecord | undefined)?.budget),
      budgetType: stringOrNull((row.budget as JsonRecord | undefined)?.budgetType),
      startDate: parseIsoDate(row.startDate),
      endDate: parseIsoDate(row.endDate),
      servingStatus: stringOrNull(row.servingStatus),
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  const adGroupById = new Map<string, { nome: string | null; campaignId: string; portfolioId: string | null }>();
  for (const row of adGroups) {
    const adGroupId = idString(row.adGroupId);
    const campaignId = idString(row.campaignId);
    if (!adGroupId || !campaignId) continue;
    const campaign = campaignById.get(campaignId);
    adGroupById.set(adGroupId, {
      nome: stringOrNull(row.name),
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
    });
    await upsertFirst("amazonAdsAdGroup", { profileId, adGroupId }, {
      profileId,
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
      adGroupId,
      nome: stringOrNull(row.name),
      estado: stringOrNull(row.state),
      defaultBidCentavos: moneyToCentavos(row.defaultBid),
      servingStatus: stringOrNull(row.servingStatus),
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  for (const row of productAds) {
    const adId = idString(row.adId);
    const campaignId = idString(row.campaignId);
    const adGroupId = idString(row.adGroupId);
    if (!adId || !campaignId || !adGroupId) continue;
    const campaign = campaignById.get(campaignId);
    await upsertFirst("amazonAdsProductAd", { profileId, adId }, {
      profileId,
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
      adGroupId,
      adId,
      sku: stringOrNull(row.sku),
      asin: stringOrNull(row.asin),
      estado: stringOrNull(row.state),
      servingStatus: stringOrNull(row.servingStatus),
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  for (const row of keywords) {
    const keywordId = idString(row.keywordId);
    const campaignId = idString(row.campaignId);
    const adGroupId = idString(row.adGroupId);
    if (!keywordId || !campaignId || !adGroupId || !row.keywordText) continue;
    const campaign = campaignById.get(campaignId);
    const adGroup = adGroupById.get(adGroupId);
    await upsertFirst("amazonAdsKeyword", { profileId, keywordId }, {
      profileId,
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
      adGroupId,
      keywordId,
      keywordText: row.keywordText,
      matchType: stringOrNull(row.matchType),
      estado: stringOrNull(row.state),
      bidCentavos: moneyToCentavos(row.bid),
      servingStatus: stringOrNull(row.servingStatus),
      campaignName: campaign?.nome ?? null,
      adGroupName: adGroup?.nome ?? null,
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  for (const row of targets) {
    const targetId = idString(row.targetId);
    const campaignId = idString(row.campaignId);
    const adGroupId = idString(row.adGroupId);
    if (!targetId || !campaignId || !adGroupId) continue;
    const campaign = campaignById.get(campaignId);
    const adGroup = adGroupById.get(adGroupId);
    await upsertFirst("amazonAdsTarget", { profileId, targetId }, {
      profileId,
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
      adGroupId,
      targetId,
      expressionType: stringOrNull(row.expressionType),
      expressionText: expressionToText(row.expression),
      targetType: expressionType(row.expression),
      estado: stringOrNull(row.state),
      bidCentavos: moneyToCentavos(row.bid),
      servingStatus: stringOrNull(row.servingStatus),
      campaignName: campaign?.nome ?? null,
      adGroupName: adGroup?.nome ?? null,
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  for (const row of negativeKeywords) {
    const negativeKeywordId = idString(row.negativeKeywordId ?? row.keywordId);
    const campaignId = idString(row.campaignId);
    if (!negativeKeywordId || !campaignId || !row.keywordText) continue;
    const campaign = campaignById.get(campaignId);
    await upsertFirst("amazonAdsNegativeKeyword", { profileId, negativeKeywordId }, {
      profileId,
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
      adGroupId: idString(row.adGroupId),
      negativeKeywordId,
      keywordText: row.keywordText,
      matchType: stringOrNull(row.matchType),
      estado: stringOrNull(row.state),
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  for (const row of negativeTargets) {
    const negativeTargetId = idString(row.negativeTargetId ?? row.targetId);
    const campaignId = idString(row.campaignId);
    if (!negativeTargetId || !campaignId) continue;
    const campaign = campaignById.get(campaignId);
    await upsertFirst("amazonAdsNegativeTarget", { profileId, negativeTargetId }, {
      profileId,
      campaignId,
      portfolioId: campaign?.portfolioId ?? null,
      adGroupId: idString(row.adGroupId),
      negativeTargetId,
      expressionType: stringOrNull(row.expressionType),
      expressionText: expressionToText(row.expression),
      targetType: expressionType(row.expression),
      estado: stringOrNull(row.state),
      ultimaSync: now,
      payloadJson: json(row),
    });
  }

  return {
    portfolios: portfolios.length,
    campaigns: campaigns.length,
    adGroups: adGroups.length,
    productAds: productAds.length,
    keywords: keywords.length,
    targets: targets.length,
    negativeKeywords: negativeKeywords.length,
    negativeTargets: negativeTargets.length,
  };
}

async function syncOptimizerReports(creds: AdsAPICredentials) {
  const profileId = requireProfileId(creds);
  const end = startOfAdsDay(addDays(new Date(), -1));
  const start = startOfAdsDay(addDays(end, -DEFAULT_REPORT_DAYS + 1));
  const [targeting, searchTerms] = await Promise.all([
    syncReportLifecycle({
      creds,
      profileId,
      reportKey: "TARGETING",
      start,
      end,
      create: createSpTargetingReport,
      persist: persistTargetingRows,
    }),
    syncReportLifecycle({
      creds,
      profileId,
      reportKey: "SEARCH_TERM",
      start,
      end,
      create: createSpSearchTermReport,
      persist: persistSearchTermRows,
    }),
  ]);
  return { targeting, searchTerms };
}

async function syncOptimizerReportsWithCooldown(creds: AdsAPICredentials) {
  try {
    return await syncOptimizerReports(creds);
  } catch (error) {
    if (isAmazonQuotaCooldownError(error)) {
      return {
        status: "COOLDOWN" as const,
        operation: error.operation,
        retryAt: error.nextAllowedAt.toISOString(),
      };
    }
    throw error;
  }
}

async function backfillOptimizerReportsWithCooldown(creds: AdsAPICredentials) {
  try {
    return await backfillOptimizerReports(creds);
  } catch (error) {
    if (isAmazonQuotaCooldownError(error)) {
      return {
        status: "COOLDOWN" as const,
        operation: error.operation,
        retryAt: error.nextAllowedAt.toISOString(),
      };
    }
    throw error;
  }
}

async function backfillOptimizerReports(creds: AdsAPICredentials) {
  const profileId = requireProfileId(creds);
  const today = startOfAdsDay(new Date());
  const earliestAvailable = startOfAdsDay(addDays(today, -REPORT_RETENTION_DAYS));
  const latestClosed = startOfAdsDay(addDays(today, -1));

  const [targeting, searchTerms] = await Promise.all([
    syncBackfillReportLifecycle({
      creds,
      profileId,
      reportKey: "TARGETING_BACKFILL",
      earliestAvailable,
      latestClosed,
      create: createSpTargetingReport,
      persist: persistTargetingRows,
    }),
    syncBackfillReportLifecycle({
      creds,
      profileId,
      reportKey: "SEARCH_TERM_BACKFILL",
      earliestAvailable,
      latestClosed,
      create: createSpSearchTermReport,
      persist: persistSearchTermRows,
    }),
  ]);

  return { targeting, searchTerms };
}

async function countOptimizerMetrics(profileId: string) {
  const [targeting, searchTerms] = await Promise.all([
    db.amazonAdsTargetingMetricDaily.count({ where: { profileId } }),
    db.amazonAdsSearchTermMetricDaily.count({ where: { profileId } }),
  ]);
  return { targeting, searchTerms };
}

function reportsReady(reports: Awaited<ReturnType<typeof syncOptimizerReports>>) {
  return reports.targeting.status === "DONE" || reports.searchTerms.status === "DONE";
}

async function syncReportLifecycle(args: {
  creds: AdsAPICredentials;
  profileId: string;
  reportKey: string;
  start: Date;
  end: Date;
  create: typeof createSpTargetingReport;
  persist: (profileId: string, rows: AdsReportRow[]) => Promise<number>;
}) {
  const pendingId = await getState(args.profileId, args.reportKey, "pendingId");
  const pendingStart = await getState(args.profileId, args.reportKey, "start");
  const pendingEnd = await getState(args.profileId, args.reportKey, "end");
  const start = pendingId && pendingStart ? new Date(pendingStart) : args.start;
  const end = pendingId && pendingEnd ? new Date(pendingEnd) : args.end;

  if (!pendingId) {
    const created = await args.create(args.creds, {
      startDate: isoDate(start),
      endDate: isoDate(end),
    });
    await setState(args.profileId, args.reportKey, "pendingId", created.reportId);
    await setState(args.profileId, args.reportKey, "start", start.toISOString());
    await setState(args.profileId, args.reportKey, "end", end.toISOString());
    return {
      status: "PENDING_NEW",
      reportId: created.reportId,
      window: { startDate: isoDate(start), endDate: isoDate(end) },
    };
  }

  const report = await getAdsReport(args.creds, pendingId);
  const status = (report.status || "").toUpperCase();
  if (status !== "COMPLETED" && status !== "SUCCESS") {
    if (status === "FAILED" || status === "CANCELLED") {
      await clearReportState(args.profileId, args.reportKey);
      return {
        status: "FAILED",
        reportId: pendingId,
        processingStatus: status,
        window: { startDate: isoDate(start), endDate: isoDate(end) },
      };
    }
    return {
      status: "PENDING_PROCESSING",
      reportId: pendingId,
      processingStatus: status || "UNKNOWN",
      window: { startDate: isoDate(start), endDate: isoDate(end) },
    };
  }

  if (!report.url) {
    await clearReportState(args.profileId, args.reportKey);
    return {
      status: "FAILED",
      reportId: pendingId,
      processingStatus: "NO_URL",
      window: { startDate: isoDate(start), endDate: isoDate(end) },
    };
  }

  const rows = await downloadAdsReportRows(report.url);
  const saved = await args.persist(args.profileId, rows);
  await clearReportState(args.profileId, args.reportKey);
  await setState(args.profileId, args.reportKey, "lastCompletedAt", new Date().toISOString());
  return {
    status: "DONE",
    reportId: pendingId,
    rows: rows.length,
    saved,
    window: { startDate: isoDate(start), endDate: isoDate(end) },
  };
}

async function syncBackfillReportLifecycle(args: {
  creds: AdsAPICredentials;
  profileId: string;
  reportKey: string;
  earliestAvailable: Date;
  latestClosed: Date;
  create: typeof createSpTargetingReport;
  persist: (profileId: string, rows: AdsReportRow[]) => Promise<number>;
}) {
  const window = await getNextBackfillWindow(args);
  if (!window) {
    const cursor = await getState(args.profileId, args.reportKey, "cursor");
    return {
      status: "COMPLETE" as const,
      cursor,
      earliestAvailable: isoDate(args.earliestAvailable),
      latestClosed: isoDate(args.latestClosed),
    };
  }

  const result = await syncReportLifecycle({
    creds: args.creds,
    profileId: args.profileId,
    reportKey: args.reportKey,
    start: window.start,
    end: window.end,
    create: args.create,
    persist: args.persist,
  });

  if (result.status === "DONE") {
    const nextCursor = addDays(window.end, 1);
    await setState(args.profileId, args.reportKey, "cursor", nextCursor.toISOString());
    return {
      ...result,
      cursor: nextCursor.toISOString(),
      complete: nextCursor > args.latestClosed,
    };
  }

  return {
    ...result,
    cursor: window.start.toISOString(),
    complete: false,
  };
}

async function getNextBackfillWindow(args: {
  profileId: string;
  reportKey: string;
  earliestAvailable: Date;
  latestClosed: Date;
}) {
  const [pendingStart, pendingEnd] = await Promise.all([
    getState(args.profileId, args.reportKey, "start"),
    getState(args.profileId, args.reportKey, "end"),
  ]);
  if (pendingStart && pendingEnd) {
    return { start: new Date(pendingStart), end: new Date(pendingEnd) };
  }

  const cursorIso = await getState(args.profileId, args.reportKey, "cursor");
  const cursor = cursorIso ? startOfAdsDay(new Date(cursorIso)) : args.earliestAvailable;
  const start = cursor < args.earliestAvailable ? args.earliestAvailable : cursor;
  if (start > args.latestClosed) return null;

  const tentativeEnd = addDays(start, BACKFILL_WINDOW_DAYS - 1);
  return {
    start,
    end: tentativeEnd > args.latestClosed ? args.latestClosed : tentativeEnd,
  };
}

async function getOptimizerCoverage(profileId: string) {
  const today = startOfAdsDay(new Date());
  const earliestAvailable = startOfAdsDay(addDays(today, -REPORT_RETENTION_DAYS));
  const latestClosed = startOfAdsDay(addDays(today, -1));
  const expectedDays = Math.max(
    0,
    differenceInCalendarDays(latestClosed, earliestAvailable) + 1,
  );

  const [targeting, searchTerms, targetingBackfill, searchTermBackfill] =
    await Promise.all([
      getMetricCoverage("amazonAdsTargetingMetricDaily", profileId, expectedDays),
      getMetricCoverage("amazonAdsSearchTermMetricDaily", profileId, expectedDays),
      getBackfillState(profileId, "TARGETING_BACKFILL", earliestAvailable, latestClosed),
      getBackfillState(profileId, "SEARCH_TERM_BACKFILL", earliestAvailable, latestClosed),
    ]);

  const minDates = [targeting.minDate, searchTerms.minDate].filter(Boolean).sort();
  const maxDates = [targeting.maxDate, searchTerms.maxDate].filter(Boolean).sort();

  return {
    earliestAvailable: isoDate(earliestAvailable),
    latestClosed: isoDate(latestClosed),
    expectedDays,
    historyStartDate: minDates[0] ?? null,
    historyEndDate: maxDates[maxDates.length - 1] ?? null,
    targeting,
    searchTerms,
    backfill: {
      targeting: targetingBackfill,
      searchTerms: searchTermBackfill,
      pending:
        targetingBackfill.status === "PENDING" ||
        searchTermBackfill.status === "PENDING",
      complete:
        targetingBackfill.status === "COMPLETE" &&
        searchTermBackfill.status === "COMPLETE",
    },
  };
}

async function getMetricCoverage(
  model: "amazonAdsTargetingMetricDaily" | "amazonAdsSearchTermMetricDaily",
  profileId: string,
  expectedDays: number,
) {
  const delegate = db[model] as unknown as {
    aggregate(args: unknown): Promise<{
      _min: { data: Date | null };
      _max: { data: Date | null };
      _count: { _all: number };
    }>;
    findMany(args: unknown): Promise<Array<{ data: Date }>>;
  };
  const [aggregate, distinctDays] = await Promise.all([
    delegate.aggregate({
      where: { profileId },
      _min: { data: true },
      _max: { data: true },
      _count: { _all: true },
    }),
    delegate.findMany({
      where: { profileId },
      distinct: ["data"],
      select: { data: true },
    }),
  ]);
  const minDate = aggregate._min.data ? isoDate(aggregate._min.data) : null;
  const maxDate = aggregate._max.data ? isoDate(aggregate._max.data) : null;
  return {
    minDate,
    maxDate,
    rows: aggregate._count._all,
    daysWithData: distinctDays.length,
    expectedDays,
  };
}

async function getBackfillState(
  profileId: string,
  reportKey: string,
  earliestAvailable: Date,
  latestClosed: Date,
) {
  const [pendingId, pendingStart, pendingEnd, cursor, lastCompletedAt] =
    await Promise.all([
      getState(profileId, reportKey, "pendingId"),
      getState(profileId, reportKey, "start"),
      getState(profileId, reportKey, "end"),
      getState(profileId, reportKey, "cursor"),
      getState(profileId, reportKey, "lastCompletedAt"),
    ]);

  if (pendingId) {
    return {
      status: "PENDING" as const,
      pendingId,
      window:
        pendingStart && pendingEnd
          ? { startDate: isoDate(new Date(pendingStart)), endDate: isoDate(new Date(pendingEnd)) }
          : null,
      cursor,
      progressPct: progressPct(cursor ?? pendingStart, earliestAvailable, latestClosed),
      lastCompletedAt,
    };
  }

  const cursorDate = cursor ? new Date(cursor) : earliestAvailable;
  const complete = cursorDate > latestClosed;
  return {
    status: complete ? ("COMPLETE" as const) : ("READY" as const),
    pendingId: null,
    window: null,
    cursor,
    progressPct: progressPct(cursor, earliestAvailable, latestClosed),
    lastCompletedAt,
  };
}

async function persistTargetingRows(profileId: string, rows: AdsReportRow[]) {
  const parsed = parseSpTargetingRows(rows);
  for (const row of parsed) {
    await upsertFirst(
      "amazonAdsTargetingMetricDaily",
      { profileId, naturalKey: row.naturalKey },
      metricData(profileId, row),
    );
  }
  return parsed.length;
}

async function persistSearchTermRows(profileId: string, rows: AdsReportRow[]) {
  const parsed = parseSpSearchTermRows(rows);
  for (const row of parsed) {
    await upsertFirst(
      "amazonAdsSearchTermMetricDaily",
      { profileId, naturalKey: row.naturalKey },
      {
        ...metricData(profileId, row),
        searchTerm: row.searchTerm,
      },
    );
  }
  return parsed.length;
}

function metricData(profileId: string, row: AdsOptimizerMetricRow) {
  return {
    profileId,
    naturalKey: row.naturalKey,
    data: row.data,
    campaignId: row.campaignId,
    portfolioId: row.portfolioId,
    campaignName: row.campaignName,
    adGroupId: row.adGroupId,
    adGroupName: row.adGroupName,
    entityType: row.entityType,
    entityId: row.entityId,
    keywordId: row.keywordId,
    targetId: row.targetId,
    keywordText: row.keywordText,
    targetingText: row.targetingText,
    matchType: row.matchType,
    sku: row.sku,
    asin: row.asin,
    impressoes: row.impressoes,
    cliques: row.cliques,
    gastoCentavos: row.gastoCentavos,
    vendasCentavos: row.vendasCentavos,
    unidades: row.unidades,
    pedidos: row.pedidos,
    acos: row.acos,
    payloadJson: json(row.payload),
  };
}

async function buildOptimizationSnapshot(profileId: string) {
  const today = startOfAdsDay(new Date());
  const last7Start = addDays(today, -7);
  const prev7Start = addDays(today, -14);
  const prev7End = addDays(last7Start, -1);
  const last30Start = addDays(today, -30);

  const [keywords, targets, targetingRows, searchRows, portfolios] = await Promise.all([
    db.amazonAdsKeyword.findMany({ where: { profileId } }),
    db.amazonAdsTarget.findMany({ where: { profileId } }),
    db.amazonAdsTargetingMetricDaily.findMany({ where: { profileId } }),
    db.amazonAdsSearchTermMetricDaily.findMany({ where: { profileId } }),
    db.amazonAdsPortfolio.findMany({ where: { profileId } }),
  ]);
  const portfolioNameById = new Map(portfolios.map((p) => [p.portfolioId, p.nome]));

  const entities: OptimizerEntity[] = [
    ...keywords.map((k) => ({
      entityType: "KEYWORD" as const,
      entityId: k.keywordId,
      label: k.keywordText,
      campaignId: k.campaignId,
      campaignName: k.campaignName,
      portfolioId: k.portfolioId,
      portfolioName: k.portfolioId ? portfolioNameById.get(k.portfolioId) ?? null : null,
      adGroupId: k.adGroupId,
      adGroupName: k.adGroupName,
      keywordId: k.keywordId,
      targetId: null,
      searchTerm: null,
      matchType: k.matchType,
      estado: k.estado,
      currentBidCentavos: k.bidCentavos,
      sku: null,
      asin: null,
    })),
    ...targets.map((t) => ({
      entityType: "TARGET" as const,
      entityId: t.targetId,
      label: t.expressionText,
      campaignId: t.campaignId,
      campaignName: t.campaignName,
      portfolioId: t.portfolioId,
      portfolioName: t.portfolioId ? portfolioNameById.get(t.portfolioId) ?? null : null,
      adGroupId: t.adGroupId,
      adGroupName: t.adGroupName,
      keywordId: null,
      targetId: t.targetId,
      searchTerm: null,
      matchType: t.expressionType,
      estado: t.estado,
      currentBidCentavos: t.bidCentavos,
      sku: null,
      asin: null,
    })),
  ];

  const entityById = new Map(entities.map((e) => [`${e.entityType}:${e.entityId}`, e]));
  const searchEntities = buildSearchTermEntities(searchRows, entityById);
  const allEntities = [...entities, ...searchEntities];

  return {
    items: allEntities.map((entity) => ({
      entity,
      metrics7d: aggregateMetrics(targetingRows, searchRows, entity, last7Start, today),
      metricsPrev7d: aggregateMetrics(targetingRows, searchRows, entity, prev7Start, prev7End),
      metrics30d: aggregateMetrics(targetingRows, searchRows, entity, last30Start, today),
      metricsLifetime: aggregateMetrics(targetingRows, searchRows, entity, null, null),
    })),
  };
}

function buildSearchTermEntities(
  rows: Array<{
    campaignId: string;
    portfolioId: string | null;
    campaignName: string | null;
    adGroupId: string | null;
    adGroupName: string | null;
    keywordId: string | null;
    targetId: string | null;
    searchTerm: string;
    matchType: string | null;
    sku: string | null;
    asin: string | null;
  }>,
  entityById: Map<string, OptimizerEntity>,
) {
  const map = new Map<string, OptimizerEntity>();
  for (const row of rows) {
    const parentKey = row.keywordId
      ? `KEYWORD:${row.keywordId}`
      : row.targetId
        ? `TARGET:${row.targetId}`
        : null;
    const parent = parentKey ? entityById.get(parentKey) : null;
    const entityId = `SEARCH_TERM:${row.campaignId}:${row.adGroupId ?? ""}:${row.keywordId ?? row.targetId ?? ""}:${row.searchTerm}`;
    if (map.has(entityId)) continue;
    map.set(entityId, {
      entityType: "SEARCH_TERM",
      entityId,
      label: row.searchTerm,
      campaignId: row.campaignId,
      portfolioId: row.portfolioId ?? parent?.portfolioId ?? null,
      portfolioName: parent?.portfolioName ?? null,
      campaignName: row.campaignName ?? parent?.campaignName ?? null,
      adGroupId: row.adGroupId,
      adGroupName: row.adGroupName ?? parent?.adGroupName ?? null,
      keywordId: row.keywordId,
      targetId: row.targetId,
      searchTerm: row.searchTerm,
      matchType: row.matchType ?? parent?.matchType ?? null,
      estado: parent?.estado ?? "enabled",
      currentBidCentavos: parent?.currentBidCentavos ?? null,
      sku: row.sku,
      asin: row.asin,
    });
  }
  return [...map.values()];
}

function aggregateMetrics(
  targetingRows: Array<{
    data: Date;
    entityType: string;
    entityId: string;
    impressoes: number;
    cliques: number;
    gastoCentavos: number;
    vendasCentavos: number;
    pedidos: number;
    unidades: number;
  }>,
  searchRows: Array<{
    data: Date;
    campaignId: string;
    adGroupId: string | null;
    keywordId: string | null;
    targetId: string | null;
    searchTerm: string;
    impressoes: number;
    cliques: number;
    gastoCentavos: number;
    vendasCentavos: number;
    pedidos: number;
    unidades: number;
  }>,
  entity: OptimizerEntity,
  start: Date | null,
  end: Date | null,
): AdsOptimizerMetrics {
  const acc: MetricAccumulator = {
    impressoes: 0,
    cliques: 0,
    gastoCentavos: 0,
    vendasCentavos: 0,
    pedidos: 0,
    unidades: 0,
  };
  const rows =
    entity.entityType === "SEARCH_TERM"
      ? searchRows.filter((row) => searchRowMatches(row, entity))
      : targetingRows.filter(
          (row) => row.entityType === entity.entityType && row.entityId === entity.entityId,
        );
  for (const row of rows) {
    if (start && row.data < start) continue;
    if (end && row.data > end) continue;
    acc.impressoes += row.impressoes;
    acc.cliques += row.cliques;
    acc.gastoCentavos += row.gastoCentavos;
    acc.vendasCentavos += row.vendasCentavos;
    acc.pedidos += row.pedidos;
    acc.unidades += row.unidades;
  }
  if (rows.length === 0) return emptyMetrics();
  return deriveMetrics(acc);
}

function searchRowMatches(
  row: {
    campaignId: string;
    adGroupId: string | null;
    keywordId: string | null;
    targetId: string | null;
    searchTerm: string;
  },
  entity: OptimizerEntity,
) {
  return (
    row.campaignId === entity.campaignId &&
    row.adGroupId === entity.adGroupId &&
    row.keywordId === entity.keywordId &&
    row.targetId === entity.targetId &&
    row.searchTerm === entity.searchTerm
  );
}

async function executeRecommendation(
  creds: AdsAPICredentials,
  rec: Awaited<ReturnType<typeof db.adsOptimizationRecommendation.findMany>>[number],
  session: SessionPayload,
) {
  const stale = await validateRecommendationFresh(rec);
  if (stale) {
    await markRecommendationStale(rec.id, stale, session);
    return { id: rec.id, status: "STALE", message: stale };
  }

  const request = buildAmazonActionPayload(rec);
  try {
    const response = await dispatchAmazonAction(creds, rec.actionType, request);
    await db.adsOptimizationExecutionLog.create({
      data: {
        recommendationId: rec.id,
        status: "APPLIED",
        requestJson: json(request),
        responseJson: json(response),
        executadoPorId: session.uid,
        executadoPorEmail: session.email,
      },
    });
    await db.adsOptimizationRecommendation.update({
      where: { id: rec.id },
      data: {
        status: "APPLIED",
        executadoEm: new Date(),
        amazonPayloadJson: json(request),
      },
    });
    return { id: rec.id, status: "APPLIED" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.adsOptimizationExecutionLog.create({
      data: {
        recommendationId: rec.id,
        status: "FAILED",
        requestJson: json(request),
        errorMessage: message,
        executadoPorId: session.uid,
        executadoPorEmail: session.email,
      },
    });
    await db.adsOptimizationRecommendation.update({
      where: { id: rec.id },
      data: { status: "FAILED", errorMessage: message },
    });
    return { id: rec.id, status: "FAILED", message };
  }
}

async function validateRecommendationFresh(
  rec: Awaited<ReturnType<typeof db.adsOptimizationRecommendation.findMany>>[number],
) {
  if (rec.entityType === "KEYWORD" || rec.keywordId) {
    const keyword = await db.amazonAdsKeyword.findFirst({
      where: { profileId: rec.profileId, keywordId: rec.keywordId ?? rec.entityId },
    });
    if (!keyword) return "Keyword não encontrada no snapshot atual";
    if (!ACTIVE_STATES.has((keyword.estado ?? "").toLowerCase())) {
      return `Keyword não está ativa (${keyword.estado ?? "sem estado"})`;
    }
    if (
      rec.currentBidCentavos != null &&
      keyword.bidCentavos != null &&
      rec.currentBidCentavos !== keyword.bidCentavos
    ) {
      return `Bid atual mudou de ${rec.currentBidCentavos} para ${keyword.bidCentavos}`;
    }
  }
  if (rec.entityType === "TARGET" || rec.targetId) {
    const target = await db.amazonAdsTarget.findFirst({
      where: { profileId: rec.profileId, targetId: rec.targetId ?? rec.entityId },
    });
    if (!target) return "Target não encontrado no snapshot atual";
    if (!ACTIVE_STATES.has((target.estado ?? "").toLowerCase())) {
      return `Target não está ativo (${target.estado ?? "sem estado"})`;
    }
    if (
      rec.currentBidCentavos != null &&
      target.bidCentavos != null &&
      rec.currentBidCentavos !== target.bidCentavos
    ) {
      return `Bid atual mudou de ${rec.currentBidCentavos} para ${target.bidCentavos}`;
    }
  }
  return null;
}

async function markRecommendationStale(
  id: string,
  staleReason: string,
  session: SessionPayload,
) {
  await db.adsOptimizationExecutionLog.create({
    data: {
      recommendationId: id,
      status: "STALE",
      errorMessage: staleReason,
      executadoPorId: session.uid,
      executadoPorEmail: session.email,
    },
  });
  await db.adsOptimizationRecommendation.update({
    where: { id },
    data: { status: "STALE", staleReason },
  });
}

function buildAmazonActionPayload(
  rec: Awaited<ReturnType<typeof db.adsOptimizationRecommendation.findMany>>[number],
) {
  if (rec.actionType === "INCREASE_BID" || rec.actionType === "DECREASE_BID") {
    if (!rec.proposedBidCentavos) throw new Error("bid proposto ausente");
    if (rec.keywordId) {
      return { keywords: [{ keywordId: rec.keywordId, bid: rec.proposedBidCentavos / 100 }] };
    }
    if (rec.targetId) {
      return { targetingClauses: [{ targetId: rec.targetId, bid: rec.proposedBidCentavos / 100 }] };
    }
  }
  if (rec.actionType === "PAUSE_KEYWORD") {
    return { keywords: [{ keywordId: rec.keywordId ?? rec.entityId, state: "paused" }] };
  }
  if (rec.actionType === "PAUSE_TARGET") {
    return { targetingClauses: [{ targetId: rec.targetId ?? rec.entityId, state: "paused" }] };
  }
  if (rec.actionType === "ADD_NEGATIVE_KEYWORD") {
    return {
      negativeKeywords: [{
        campaignId: rec.campaignId,
        adGroupId: rec.adGroupId ?? undefined,
        keywordText: rec.searchTerm ?? rec.entityId,
        matchType: "NEGATIVE_EXACT",
        state: "enabled",
      }],
    };
  }
  if (rec.actionType === "ADD_NEGATIVE_TARGET") {
    return {
      negativeTargetingClauses: [{
        campaignId: rec.campaignId,
        adGroupId: rec.adGroupId ?? undefined,
        expression: [{ type: "ASIN_SAME_AS", value: rec.searchTerm ?? rec.entityId }],
        expressionType: "MANUAL",
        state: "enabled",
      }],
    };
  }
  if (rec.actionType === "CREATE_EXACT_KEYWORD") {
    return {
      keywords: [{
        campaignId: rec.campaignId,
        adGroupId: rec.adGroupId,
        keywordText: rec.searchTerm ?? rec.entityId,
        matchType: "EXACT",
        state: "enabled",
        bid: (rec.proposedBidCentavos ?? rec.currentBidCentavos ?? 50) / 100,
      }],
    };
  }
  throw new Error(`ação não suportada: ${rec.actionType}`);
}

async function dispatchAmazonAction(
  creds: AdsAPICredentials,
  actionType: string,
  request: JsonRecord,
) {
  if (actionType === "INCREASE_BID" || actionType === "DECREASE_BID") {
    if (Array.isArray(request.keywords)) {
      return updateSponsoredProductsKeywords(creds, request.keywords as never);
    }
    return updateSponsoredProductsTargets(creds, request.targetingClauses as never);
  }
  if (actionType === "PAUSE_KEYWORD") {
    return updateSponsoredProductsKeywords(creds, request.keywords as never);
  }
  if (actionType === "PAUSE_TARGET") {
    return updateSponsoredProductsTargets(creds, request.targetingClauses as never);
  }
  if (actionType === "ADD_NEGATIVE_KEYWORD") {
    return createSponsoredProductsNegativeKeywords(creds, request.negativeKeywords as never);
  }
  if (actionType === "ADD_NEGATIVE_TARGET") {
    return createSponsoredProductsNegativeTargets(creds, request.negativeTargetingClauses as never);
  }
  if (actionType === "CREATE_EXACT_KEYWORD") {
    return createSponsoredProductsKeywords(creds, request.keywords as never);
  }
  throw new Error(`ação não suportada: ${actionType}`);
}

async function collectPages<T>(
  fn: (nextToken?: string) => Promise<Record<string, T[] | string | undefined>>,
  key: string,
) {
  const items: T[] = [];
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const result = await fn(nextToken);
    const pageItems = result[key];
    if (Array.isArray(pageItems)) items.push(...pageItems);
    nextToken = typeof result.nextToken === "string" ? result.nextToken : undefined;
    pages += 1;
  } while (nextToken && pages < MAX_PAGES);
  return items;
}

async function upsertFirst(
  model: keyof Pick<
    typeof db,
    | "amazonAdsPortfolio"
    | "amazonAdsCampaignEntity"
    | "amazonAdsAdGroup"
    | "amazonAdsProductAd"
    | "amazonAdsKeyword"
    | "amazonAdsTarget"
    | "amazonAdsNegativeKeyword"
    | "amazonAdsNegativeTarget"
    | "amazonAdsTargetingMetricDaily"
    | "amazonAdsSearchTermMetricDaily"
  >,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const delegate = db[model] as unknown as {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  const existing = await delegate.findFirst({ where });
  if (!existing) return delegate.create({ data });
  return delegate.update({ where: { id: existing.id }, data });
}

async function getState(profileId: string, tipo: string, chave: string) {
  const row = await db.amazonAdsOptimizerState.findFirst({
    where: { profileId, tipo, chave },
    select: { valor: true },
  });
  return row?.valor ?? null;
}

async function setState(profileId: string, tipo: string, chave: string, valor: string) {
  const existing = await db.amazonAdsOptimizerState.findFirst({
    where: { profileId, tipo, chave },
    select: { id: true },
  });
  if (!existing) {
    await db.amazonAdsOptimizerState.create({
      data: { profileId, tipo, chave, valor },
    });
  } else {
    await db.amazonAdsOptimizerState.update({
      where: { id: existing.id },
      data: { valor },
    });
  }
}

async function clearReportState(profileId: string, tipo: string) {
  await db.amazonAdsOptimizerState.deleteMany({
    where: { profileId, tipo, chave: { in: ["pendingId", "start", "end"] } },
  });
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfAdsDay(date: Date) {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function progressPct(value: string | null | undefined, start: Date, end: Date) {
  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  if (!value) return 0;
  const current = startOfAdsDay(new Date(value));
  const doneDays = Math.min(totalDays, Math.max(0, differenceInCalendarDays(current, start)));
  return Math.round((doneDays / totalDays) * 100);
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function idString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function stringOrNull(value: unknown): string | null {
  return idString(value);
}

function parseIsoDate(value: unknown): Date | null {
  const text = idString(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function moneyToCentavos(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  return null;
}

function expressionToText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "object" && item
          ? `${String((item as JsonRecord).type ?? "")}:${String((item as JsonRecord).value ?? "")}`
          : String(item),
      )
      .join(", ");
  }
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function expressionType(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "object" && item) as
      | JsonRecord
      | undefined;
    return first?.type != null ? String(first.type) : null;
  }
  if (value && typeof value === "object" && "type" in value) {
    return String((value as JsonRecord).type);
  }
  return null;
}
