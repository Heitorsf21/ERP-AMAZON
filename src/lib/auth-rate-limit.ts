import type { NextRequest } from "next/server";

const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_FAILURE_MAX = 25;

type LoginFailureBucket = {
  count: number;
  resetAt: number;
};

type LoginFailureResult = {
  limited: boolean;
  count: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const loginFailureBuckets = new Map<string, LoginFailureBucket>();

function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export function getLoginFailureKey(headers: Headers, email: string): string {
  const normalizedEmail = email.toLowerCase().trim() || "unknown";
  return `${getClientIp(headers)}:${normalizedEmail}`;
}

export function recordLoginFailureByKey(
  key: string,
  now = Date.now(),
): LoginFailureResult {
  const bucket = loginFailureBuckets.get(key);
  const activeBucket =
    bucket && bucket.resetAt > now
      ? bucket
      : { count: 0, resetAt: now + LOGIN_FAILURE_WINDOW_MS };

  activeBucket.count += 1;
  loginFailureBuckets.set(key, activeBucket);

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((activeBucket.resetAt - now) / 1000),
  );

  return {
    limited: activeBucket.count > LOGIN_FAILURE_MAX,
    count: activeBucket.count,
    remaining: Math.max(0, LOGIN_FAILURE_MAX - activeBucket.count),
    resetAt: activeBucket.resetAt,
    retryAfterSeconds,
  };
}

export function recordLoginFailure(
  req: Request | NextRequest,
  email: string,
): LoginFailureResult {
  return recordLoginFailureByKey(getLoginFailureKey(req.headers, email));
}

export function resetLoginFailuresByKey(key: string): void {
  loginFailureBuckets.delete(key);
}

export function resetLoginFailures(req: Request | NextRequest, email: string): void {
  resetLoginFailuresByKey(getLoginFailureKey(req.headers, email));
}

export function clearLoginFailureBucketsForTests(): void {
  loginFailureBuckets.clear();
}

export const LOGIN_FAILURE_LIMIT = {
  max: LOGIN_FAILURE_MAX,
  windowMs: LOGIN_FAILURE_WINDOW_MS,
};
