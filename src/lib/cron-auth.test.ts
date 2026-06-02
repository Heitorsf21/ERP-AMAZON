import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { verifyCronRequest } from "./cron-auth";

function reqWithAuth(authorization: string | null): NextRequest {
  return {
    headers: { get: (k: string) => (k === "authorization" ? authorization : null) },
  } as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyCronRequest", () => {
  it("aceita Bearer com o secret correto", () => {
    vi.stubEnv("CRON_SECRET", "segredo-super-forte-123");
    expect(verifyCronRequest(reqWithAuth("Bearer segredo-super-forte-123")).ok).toBe(true);
  });

  it("rejeita Bearer com secret errado", () => {
    vi.stubEnv("CRON_SECRET", "segredo-super-forte-123");
    expect(verifyCronRequest(reqWithAuth("Bearer errado")).ok).toBe(false);
  });

  it("rejeita header ausente", () => {
    vi.stubEnv("CRON_SECRET", "segredo-super-forte-123");
    expect(verifyCronRequest(reqWithAuth(null)).ok).toBe(false);
  });

  it("sem CRON_SECRET em produção: bloqueia", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(verifyCronRequest(reqWithAuth(null)).ok).toBe(false);
  });

  it("sem CRON_SECRET fora de produção: libera (dev)", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyCronRequest(reqWithAuth(null)).ok).toBe(true);
  });
});
