import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginFailureBucketsForTests,
  consumeRateLimit,
  LOGIN_FAILURE_LIMIT,
  recordLoginFailureByKey,
  resetLoginFailuresByKey,
  cleanupExpiredLoginThrottle,
} from "./auth-rate-limit";

describe("login failure rate limit", () => {
  beforeEach(async () => {
    await clearLoginFailureBucketsForTests();
  });

  it("bloqueia apenas depois do limite de falhas", async () => {
    let result = await recordLoginFailureByKey("ip:user@example.com", 1_000);

    for (let i = 1; i < LOGIN_FAILURE_LIMIT.max; i += 1) {
      result = await recordLoginFailureByKey("ip:user@example.com", 1_000 + i);
    }

    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(0);

    const blocked = await recordLoginFailureByKey("ip:user@example.com", 2_000);

    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limpa falhas depois de login correto", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMIT.max + 3; i += 1) {
      await recordLoginFailureByKey("ip:user@example.com", 1_000 + i);
    }

    await resetLoginFailuresByKey("ip:user@example.com");

    const result = await recordLoginFailureByKey("ip:user@example.com", 3_000);

    expect(result.limited).toBe(false);
    expect(result.count).toBe(1);
  });

  it("reinicia a janela quando o prazo expira", async () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMIT.max + 1; i += 1) {
      await recordLoginFailureByKey("ip:user@example.com", 1_000 + i);
    }

    const afterWindow = await recordLoginFailureByKey(
      "ip:user@example.com",
      1_000 + LOGIN_FAILURE_LIMIT.windowMs + 1,
    );

    expect(afterWindow.limited).toBe(false);
    expect(afterWindow.count).toBe(1);
  });

  it("cleanup remove buckets expirados", async () => {
    await recordLoginFailureByKey("ip:antigo@example.com", 1_000);
    await recordLoginFailureByKey("ip:novo@example.com", Date.now());

    const removidos = await cleanupExpiredLoginThrottle(
      1_000 + LOGIN_FAILURE_LIMIT.windowMs + 1,
    );

    expect(removidos).toBeGreaterThanOrEqual(1);
  });
});

describe("consumeRateLimit (generico — ex: recuperar-senha)", () => {
  const WINDOW_MS = 60 * 60_000;
  const MAX = 5;

  beforeEach(async () => {
    await clearLoginFailureBucketsForTests();
  });

  it("bloqueia apenas depois de exceder o max", async () => {
    const chave = "recovery:ip:user@example.com";

    let result = await consumeRateLimit(chave, WINDOW_MS, MAX, 1_000);
    for (let i = 1; i < MAX; i += 1) {
      result = await consumeRateLimit(chave, WINDOW_MS, MAX, 1_000 + i);
    }
    expect(result.limited).toBe(false);

    const blocked = await consumeRateLimit(chave, WINDOW_MS, MAX, 2_000);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reinicia a janela quando o prazo expira", async () => {
    const chave = "recovery:ip:user@example.com";

    for (let i = 0; i < MAX + 1; i += 1) {
      await consumeRateLimit(chave, WINDOW_MS, MAX, 1_000 + i);
    }

    const afterWindow = await consumeRateLimit(
      chave,
      WINDOW_MS,
      MAX,
      1_000 + WINDOW_MS + 1,
    );
    expect(afterWindow.limited).toBe(false);
    expect(afterWindow.count).toBe(1);
  });

  it("namespaces independentes nao compartilham bucket", async () => {
    await consumeRateLimit("recovery:ip:a@example.com", WINDOW_MS, MAX, 1_000);
    const outro = await consumeRateLimit(
      "login:ip:a@example.com",
      WINDOW_MS,
      MAX,
      1_000,
    );
    expect(outro.count).toBe(1);
  });
});
