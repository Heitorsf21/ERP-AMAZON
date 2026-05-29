import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRequestOrigin,
  getTrustedOrigins,
  originViolationResponse,
} from "./origin-check";

function reqWithOrigin(origin?: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: origin ? { origin } : {},
  });
}

describe("origin-check (CSRF defense-in-depth)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getTrustedOrigins deriva de APP_URL e TRUSTED_ORIGINS (sem localhost em prod)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://erp.exemplo.com/login");
    vi.stubEnv("TRUSTED_ORIGINS", "https://a.exemplo.com, https://b.exemplo.com");

    const origins = getTrustedOrigins();

    expect(origins).toContain("https://erp.exemplo.com");
    expect(origins).toContain("https://a.exemplo.com");
    expect(origins).toContain("https://b.exemplo.com");
    expect(origins).not.toContain("http://localhost:3000");
  });

  it("fail-open quando nao ha header Origin (server-to-server)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://erp.exemplo.com");
    expect(checkRequestOrigin(reqWithOrigin()).ok).toBe(true);
  });

  it("fail-open quando nao ha allowlist configurada", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("TRUSTED_ORIGINS", "");
    expect(checkRequestOrigin(reqWithOrigin("https://evil.com")).ok).toBe(true);
  });

  it("bloqueia origin fora da allowlist; aceita origin confiavel", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://erp.exemplo.com");
    expect(checkRequestOrigin(reqWithOrigin("https://evil.com")).ok).toBe(false);
    expect(checkRequestOrigin(reqWithOrigin("https://erp.exemplo.com")).ok).toBe(true);
  });

  it("report-only (default) nao retorna resposta de bloqueio", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://erp.exemplo.com");
    expect(originViolationResponse(reqWithOrigin("https://evil.com"))).toBeNull();
  });

  it("enforce retorna 403 para origin nao confiavel", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://erp.exemplo.com");
    vi.stubEnv("CSRF_ENFORCE_ORIGIN", "true");

    const res = originViolationResponse(reqWithOrigin("https://evil.com"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
