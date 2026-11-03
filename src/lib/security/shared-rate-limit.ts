import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ConsumeRateLimitResult =
  | { ok: true; allowed: true; retry_after_seconds: 0 }
  | { ok: true; allowed: false; retry_after_seconds: number }
  | { ok: false; reason: "rpc_error" | "malformed" };

export type ConsumeRateLimitsFn = (params: {
  key: string;
  minuteLimit: number;
  hourLimit: number;
}) => Promise<ConsumeRateLimitResult>;

type ConsumeRateLimitRow = {
  allowed?: unknown;
  retry_after_seconds?: unknown;
};

function parseConsumeRow(data: unknown): ConsumeRateLimitResult {
  const row: ConsumeRateLimitRow | null = Array.isArray(data)
    ? ((data[0] as ConsumeRateLimitRow | undefined) ?? null)
    : data && typeof data === "object"
      ? (data as ConsumeRateLimitRow)
      : null;

  if (!row || typeof row.allowed !== "boolean") {
    return { ok: false, reason: "malformed" };
  }

  const retryRaw = row.retry_after_seconds;
  const retry =
    typeof retryRaw === "number" && Number.isFinite(retryRaw)
      ? Math.max(0, Math.trunc(retryRaw))
      : typeof retryRaw === "string" && /^-?\d+$/.test(retryRaw)
        ? Math.max(0, Number.parseInt(retryRaw, 10))
        : null;

  if (retry === null) {
    return { ok: false, reason: "malformed" };
  }

  if (row.allowed) {
    return { ok: true, allowed: true, retry_after_seconds: 0 };
  }

  return { ok: true, allowed: false, retry_after_seconds: retry };
}

/** Production RPC caller — service-role admin client only. */
export const consumeRateLimitsViaSupabase: ConsumeRateLimitsFn = async ({
  key,
  minuteLimit,
  hourLimit,
}) => {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("consume_rate_limits", {
      p_key: key,
      p_minute_limit: minuteLimit,
      p_hour_limit: hourLimit,
    });

    if (error) {
      return { ok: false, reason: "rpc_error" };
    }

    return parseConsumeRow(data);
  } catch {
    return { ok: false, reason: "rpc_error" };
  }
};
