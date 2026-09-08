import "server-only";

import { headers } from "next/headers";

/**
 * IP/user-agent are supplemental audit evidence only (see
 * consent-repository.ts) — best-effort from request headers, never
 * required for a successful acceptance. x-forwarded-for can carry a
 * comma-separated proxy chain; only the client-facing first entry is kept.
 * Shared by every consent-acceptance call site (portal sign form, inline
 * booking clickwrap) so the capture logic lives in exactly one place.
 */
export async function captureAuditHeaders(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress = forwardedFor ? forwardedFor.split(",")[0]?.trim() || null : null;
  const userAgent = headerList.get("user-agent");
  return { ipAddress, userAgent };
}
