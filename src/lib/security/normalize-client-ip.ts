/**
 * Normalize a client IP for stable rate-limit keying.
 * Never logs or persists the result as a raw key — callers HMAC it first.
 */
export function normalizeClientIp(raw: string): string {
  let ip = raw.trim().toLowerCase();

  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  }

  const zone = ip.indexOf("%");
  if (zone !== -1) {
    ip = ip.slice(0, zone);
  }

  const v4Mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Mapped) {
    return v4Mapped[1];
  }

  return ip;
}
