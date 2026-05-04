import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginFailureBucketsForTests,
  LOGIN_FAILURE_LIMIT,
  recordLoginFailureByKey,
  resetLoginFailuresByKey,
} from "./auth-rate-limit";

describe("login failure rate limit", () => {
  beforeEach(() => {
    clearLoginFailureBucketsForTests();
  });

  it("bloqueia apenas depois do limite de falhas", () => {
    let result = recordLoginFailureByKey("ip:user@example.com", 1_000);

    for (let i = 1; i < LOGIN_FAILURE_LIMIT.max; i += 1) {
      result = recordLoginFailureByKey("ip:user@example.com", 1_000 + i);
    }

    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(0);

    const blocked = recordLoginFailureByKey("ip:user@example.com", 2_000);

    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limpa falhas depois de login correto", () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMIT.max + 3; i += 1) {
      recordLoginFailureByKey("ip:user@example.com", 1_000 + i);
    }

    resetLoginFailuresByKey("ip:user@example.com");

    const result = recordLoginFailureByKey("ip:user@example.com", 3_000);

    expect(result.limited).toBe(false);
    expect(result.count).toBe(1);
  });

  it("reinicia a janela quando o prazo expira", () => {
    for (let i = 0; i < LOGIN_FAILURE_LIMIT.max + 1; i += 1) {
      recordLoginFailureByKey("ip:user@example.com", 1_000 + i);
    }

    const afterWindow = recordLoginFailureByKey(
      "ip:user@example.com",
      1_000 + LOGIN_FAILURE_LIMIT.windowMs + 1,
    );

    expect(afterWindow.limited).toBe(false);
    expect(afterWindow.count).toBe(1);
  });
});
