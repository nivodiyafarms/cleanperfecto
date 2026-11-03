/**
 * In-process fixed-window store mirroring consume_rate_limits semantics for
 * unit tests (no database). Caps counters at limit+1; allowed only when both
 * the 60s and 3600s windows are within limit.
 */
export type FixedWindowConsumeResult = {
  allowed: boolean;
  retry_after_seconds: number;
};

export function createFixedWindowRateLimitStore() {
  const buckets = new Map<string, number>();

  function bucketKey(key: string, windowSeconds: number, windowStartSec: number): string {
    return `${key}|${windowSeconds}|${windowStartSec}`;
  }

  function consumeWindow(
    key: string,
    windowSeconds: number,
    nowMs: number,
    limit: number
  ): { count: number; windowStartSec: number } {
    const nowSec = Math.floor(nowMs / 1000);
    const windowStartSec = Math.floor(nowSec / windowSeconds) * windowSeconds;
    const id = bucketKey(key, windowSeconds, windowStartSec);
    const next = Math.min((buckets.get(id) ?? 0) + 1, limit + 1);
    buckets.set(id, next);
    return { count: next, windowStartSec };
  }

  return {
    consume(
      key: string,
      minuteLimit: number,
      hourLimit: number,
      nowMs: number = Date.now()
    ): FixedWindowConsumeResult {
      const minute = consumeWindow(key, 60, nowMs, minuteLimit);
      const hour = consumeWindow(key, 3600, nowMs, hourLimit);
      const minuteBlocked = minute.count > minuteLimit;
      const hourBlocked = hour.count > hourLimit;

      if (!minuteBlocked && !hourBlocked) {
        return { allowed: true, retry_after_seconds: 0 };
      }

      const nowSec = nowMs / 1000;
      let retry = 0;
      if (minuteBlocked) {
        retry = Math.max(0, Math.ceil(minute.windowStartSec + 60 - nowSec));
      }
      if (hourBlocked) {
        retry = Math.max(retry, Math.ceil(hour.windowStartSec + 3600 - nowSec));
      }
      return { allowed: false, retry_after_seconds: retry };
    },
    reset() {
      buckets.clear();
    },
  };
}
