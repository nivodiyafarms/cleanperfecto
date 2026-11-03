/**
 * Best-effort client IP from request headers (pure; safe for unit tests).
 *
 * On Vercel the platform sets `x-forwarded-for`; the left-most entry is the
 * original client. Falls back to `x-real-ip` when forwarded-for is absent.
 */
export function clientIpFromHeaderList(headerList: {
  get(name: string): string | null;
}): string | null {
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headerList.get("x-real-ip")?.trim();
  return realIp || null;
}
