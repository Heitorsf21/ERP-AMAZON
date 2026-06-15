import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock do Prisma: capturamos os args do create para inspecionar data.empresaId.
const createMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    amazonSyncJob: {
      create: (args: unknown) => createMock(args),
      findFirst: (args: unknown) => findFirstMock(args),
    },
  },
}));

import { enqueueAmazonSyncJob } from "./jobs";
import { runWithTenant } from "@/lib/tenant-context";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

function createdData() {
  return (createMock.mock.calls[0]?.[0] as { data: { empresaId: string | null } }).data;
}

describe("enqueueAmazonSyncJob — empresaId nunca é null (regressao SQS NOT NULL)", () => {
  beforeEach(() => {
    createMock.mockReset().mockImplementation((args) => ({
      id: "job_1",
      ...(args as { data: object }).data,
    }));
    findFirstMock.mockReset().mockResolvedValue(null);
  });

  it("resolve empresaId do contexto de tenant quando options nao passa (caso SQS)", async () => {
    await runWithTenant(
      { empresaId: "emp_x", isSuperAdmin: false, source: "worker" },
      () => enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, {}),
    );
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createdData().empresaId).toBe("emp_x");
  });

  it("cai no fallback de background (mundofs) sem contexto de tenant", async () => {
    await enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, {});
    expect(createdData().empresaId).toBe("mundofs");
  });

  it("respeita empresaId explicito das options (vence o contexto)", async () => {
    await runWithTenant(
      { empresaId: "emp_x", isSuperAdmin: false, source: "worker" },
      () => enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, { empresaId: "emp_y" }),
    );
    expect(createdData().empresaId).toBe("emp_y");
  });

  it("nunca emite empresaId null no create", async () => {
    await enqueueAmazonSyncJob(TipoAmazonSyncJob.ORDERS_SYNC, {}, {});
    expect(createdData().empresaId).not.toBeNull();
  });
});
