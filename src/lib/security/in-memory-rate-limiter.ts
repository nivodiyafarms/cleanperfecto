/**
 * Process-local sliding-window rate limiter for public server entry points
 * that have no DB-backed claim RPC. Shared across callers via a module-level
 * singleton when created once at import time.
 *
 * Not durable across serverless instances — that is intentional for
 * lightweight probe protection; abuse that spans many instances still hits
 * per-instance caps and the underlying data store.
 */
export type RateLimitDecision = { allowed: true } | { allowed: false };

export interface InMemoryRateLimiter {
  /** Record an attempt for `key` and return whether it is within the window budget. */
  take(key: string, nowMs?: number): RateLimitDecision;
  /** Test helper — drop all recorded attempts. */
  reset(): void;
}

export function createInMemoryRateLimiter(options: {
  windowMs: number;
  maxAttempts: number;
}): InMemoryRateLimiter {
  if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
    throw new Error("windowMs must be a positive number");
  }
  if (!Number.isFinite(options.maxAttempts) || options.maxAttempts <= 0) {
    throw new Error("maxAttempts must be a positive number");
  }

  const attemptsByKey = new Map<string, number[]>();

  return {
    take(key: string, nowMs: number = Date.now()): RateLimitDecision {
      const windowStart = nowMs - options.windowMs;
      const prior = attemptsByKey.get(key) ?? [];
      const recent = prior.filter((ts) => ts > windowStart);
      if (recent.length >= options.maxAttempts) {
        attemptsByKey.set(key, recent);
        return { allowed: false };
      }
      recent.push(nowMs);
      attemptsByKey.set(key, recent);
      return { allowed: true };
    },
    reset() {
      attemptsByKey.clear();
    },
  };
}
