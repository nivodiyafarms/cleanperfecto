import "server-only";

import { headers } from "next/headers";
import { clientIpFromHeaderList } from "@/lib/http/client-ip-from-headers";

/**
 * IP/user-agent are supplemental audit evidence only (see
 * consent-repository.ts) — best-effort from request headers, never
 * required for a successful acceptance. Client IP resolution is shared
 * with rate-limiting via trusted-client-ip (x-forwarded-for first entry,
 * then x-real-ip). Shared by every consent-acceptance call site (portal
 * sign form, inline booking clickwrap) so the capture logic lives in
 * exactly one place.
 */
export async function captureAuditHeaders(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const headerList = await headers();
  const ipAddress = clientIpFromHeaderList(headerList);
  const userAgent = headerList.get("user-agent");
  return { ipAddress, userAgent };
}
