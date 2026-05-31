import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OLD_TENANT_ISOLATION = process.env.TENANT_ISOLATION;
const OLD_DATABASE_URL = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.TENANT_ISOLATION = "enforce";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.db";
});

afterEach(() => {
  if (OLD_TENANT_ISOLATION == null) {
    delete process.env.TENANT_ISOLATION;
  } else {
    process.env.TENANT_ISOLATION = OLD_TENANT_ISOLATION;
  }

  if (OLD_DATABASE_URL == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = OLD_DATABASE_URL;
  }
});

describe("Ads optimizer tenant isolation", () => {
  it("registers optimizer models as tenant scoped", async () => {
    const { TENANT_MODEL_NAMES } = await import("@/lib/db");

    expect(TENANT_MODEL_NAMES.has("AmazonAdsKeyword")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("AmazonAdsTarget")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("AmazonAdsTargetingMetricDaily")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("AmazonAdsSearchTermMetricDaily")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("AdsOptimizationRecommendation")).toBe(true);
    expect(TENANT_MODEL_NAMES.has("AdsOptimizationExecutionLog")).toBe(true);
  });

  it("injects empresaId on recommendation reads and execution log writes", async () => {
    const [{ applyTenantIsolation }, { runWithTenant }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/tenant-context"),
    ]);
    const query = vi.fn(async (args: unknown) => args);

    const readArgs = await runWithTenant(
      { empresaId: "empresa-a", isSuperAdmin: false, source: "system" },
      () =>
        applyTenantIsolation({
          model: "AdsOptimizationRecommendation",
          operation: "findMany",
          args: { where: { profileId: "profile-1", status: "APPROVED" } },
          query,
        }),
    );

    expect(readArgs).toMatchObject({
      where: {
        profileId: "profile-1",
        status: "APPROVED",
        empresaId: "empresa-a",
      },
    });

    const createArgs = await runWithTenant(
      { empresaId: "empresa-a", isSuperAdmin: false, source: "system" },
      () =>
        applyTenantIsolation({
          model: "AdsOptimizationExecutionLog",
          operation: "create",
          args: { data: { recommendationId: "rec-1", status: "APPLIED" } },
          query,
        }),
    );

    expect(createArgs).toMatchObject({
      data: {
        recommendationId: "rec-1",
        status: "APPLIED",
        empresaId: "empresa-a",
      },
    });
  });
});
