import { beforeEach, describe, expect, it, vi } from "vitest";

const isCooldown = vi.fn();

vi.mock("@/lib/amazon-rate-limit", () => ({
  isAmazonQuotaCooldownError: (error: unknown) => isCooldown(error),
}));

import { forEachWithRateLimit, withAmazonRateLimitRetry } from "./rate-limit-retry";

function cooldownError(nextAllowedAtMs: number) {
  return { name: "AmazonQuotaCooldownError", nextAllowedAt: new Date(nextAllowedAtMs) };
}

beforeEach(() => {
  isCooldown.mockReset();
});

describe("withAmazonRateLimitRetry", () => {
  it("returns immediately when fn succeeds on the first try", async () => {
    isCooldown.mockReturnValue(false);
    const fn = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withAmazonRateLimitRetry(fn, { sleep, now: () => 1000 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("waits out the cooldown and retries until it succeeds", async () => {
    const err = cooldownError(1500);
    isCooldown.mockImplementation((error) => error === err);
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withAmazonRateLimitRetry(fn, {
      sleep,
      now: () => 1000,
      maxWaitMs: 5000,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    // waitMs = 1500 - 1000 = 500, + buffer 50
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(550);
  });

  it("propagates the error when the cooldown is longer than the budget", async () => {
    const err = cooldownError(100_000);
    isCooldown.mockImplementation((error) => error === err);
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withAmazonRateLimitRetry(fn, { sleep, now: () => 1000, maxWaitMs: 5000 }),
    ).rejects.toBe(err);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts when the cooldown never clears", async () => {
    const err = cooldownError(1100);
    isCooldown.mockImplementation((error) => error === err);
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withAmazonRateLimitRetry(fn, {
        sleep,
        now: () => 1000,
        maxWaitMs: 5000,
        maxAttempts: 3,
      }),
    ).rejects.toBe(err);

    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-cooldown error", async () => {
    isCooldown.mockReturnValue(false);
    const err = new Error("Ads API POST /sp/negativeKeywords -> 400: INVALID_ARGUMENT");
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      withAmazonRateLimitRetry(fn, { sleep, now: () => 1000 }),
    ).rejects.toBe(err);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries with the buffer only when the slot is already free", async () => {
    const err = cooldownError(900); // already in the past relative to now=1000
    isCooldown.mockImplementation((error) => error === err);
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await withAmazonRateLimitRetry(fn, {
      sleep,
      now: () => 1000,
      maxWaitMs: 5000,
    });

    expect(result).toBe("ok");
    expect(sleep).toHaveBeenCalledWith(50);
  });
});

describe("forEachWithRateLimit", () => {
  const passthroughRetry = <R>(fn: () => Promise<R>) => fn();

  it("processes every item in order when none fail", async () => {
    const vistos: number[] = [];

    const resultado = await forEachWithRateLimit(
      [1, 2, 3],
      async (n) => {
        vistos.push(n);
      },
      { retry: passthroughRetry, isQuotaError: () => false },
    );

    expect(vistos).toEqual([1, 2, 3]);
    expect(resultado).toEqual({ processados: 3, pausadoPorQuota: false });
  });

  it("stops gracefully at the first quota error, leaving the rest untouched", async () => {
    const vistos: number[] = [];
    const quota = new Error("SP-API quota PRODUCT_PRICING_GET_OFFERS ...");

    const resultado = await forEachWithRateLimit(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw quota;
        vistos.push(n);
      },
      { retry: passthroughRetry, isQuotaError: (e) => e === quota },
    );

    // item 1 processado; item 2 bateu em quota e parou; item 3 nunca foi tocado
    expect(vistos).toEqual([1]);
    expect(resultado).toEqual({ processados: 1, pausadoPorQuota: true });
  });

  it("propagates a non-quota error", async () => {
    const boom = new Error("boom");

    await expect(
      forEachWithRateLimit([1, 2], async () => {
        throw boom;
      }, { retry: passthroughRetry, isQuotaError: () => false }),
    ).rejects.toBe(boom);
  });

  it("runs each processed item through the retry wrapper", async () => {
    let chamadasDoRetry = 0;
    const retry = <R>(fn: () => Promise<R>): Promise<R> => {
      chamadasDoRetry += 1;
      return fn();
    };

    await forEachWithRateLimit([1, 2], async () => {}, {
      retry,
      isQuotaError: () => false,
    });

    expect(chamadasDoRetry).toBe(2);
  });
});
