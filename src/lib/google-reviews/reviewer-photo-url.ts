import type { NextConfig } from "next";

type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

/**
 * HTTPS reviewer photos on googleusercontent.com only. next.config.ts
 * imports REVIEWER_PHOTO_REMOTE_PATTERNS so the image optimizer allows the
 * same hosts the validator accepts, and no others. Query strings are left
 * unrestricted because Google photo URLs use them; ports and credentials
 * are not.
 */
export const REVIEWER_PHOTO_REMOTE_PATTERNS: RemotePattern[] = [
  { protocol: "https", hostname: "googleusercontent.com", port: "", pathname: "/**" },
  { protocol: "https", hostname: "*.googleusercontent.com", port: "", pathname: "/**" },
  { protocol: "https", hostname: "**.googleusercontent.com", port: "", pathname: "/**" },
];

const MAX_PHOTO_URL_LENGTH = 2048;

function isGoogleUserContentHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "googleusercontent.com") return true;
  if (!host.endsWith(".googleusercontent.com")) return false;
  const suffix = ".googleusercontent.com";
  const prefix = host.slice(0, -suffix.length);
  return prefix.length > 0 && !prefix.endsWith(".") && !prefix.includes("..");
}

/** True only for an HTTPS URL on googleusercontent.com or a real subdomain of it. */
export function isAllowedReviewerPhotoUrl(value: string | null | undefined): value is string {
  if (!value || value.length > MAX_PHOTO_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;
  return isGoogleUserContentHost(url.hostname);
}
