import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: { amazonNotification: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { __limparCacheSqsCobertura, empresaRecebeOrderChange, intervaloEfetivo } from "./sqs-cobertura";

const AGORA = new Date("2026-10-06T22:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  __limparCacheSqsCobertura();
});

describe("empresaRecebeOrderChange", () => {
  it("ORDER_CHANGE nas últimas 24 h = recebe SQS", async () => {
    dbMock.amazonNotification.findFirst.mockResolvedValue({ id: "n1" });
    expect(await empresaRecebeOrderChange("mundofs", AGORA)).toBe(true);
    expect(dbMock.amazonNotification.findFirst).toHaveBeenCalledWith({
      where: {
        empresaId: "mundofs",
        notificationType: "ORDER_CHANGE",
        criadoEm: { gte: new Date("2026-10-05T22:00:00Z") },
      },
      select: { id: true },
    });
  });

  it("sem notificação = não recebe, e o resultado fica em cache", async () => {
    dbMock.amazonNotification.findFirst.mockResolvedValue(null);
    expect(await empresaRecebeOrderChange("udncd", AGORA)).toBe(false);
    expect(await empresaRecebeOrderChange("udncd", AGORA)).toBe(false);
    expect(dbMock.amazonNotification.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("intervaloEfetivo", () => {
  it("empresa sem SQS usa o intervalo curto", () => {
    expect(intervaloEfetivo({ intervalMs: 900_000, intervalMsSemSqs: 120_000 }, true)).toBe(120_000);
    expect(intervaloEfetivo({ intervalMs: 900_000, intervalMsSemSqs: 120_000 }, false)).toBe(900_000);
    expect(intervaloEfetivo({ intervalMs: 600_000 }, true)).toBe(600_000);
  });
});
