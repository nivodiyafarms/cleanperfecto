const DISPLAY_TIMEZONE = "America/Chicago";

/**
 * Admin Google reviews timestamps. The app runs in UTC on Vercel, so the
 * zone has to be set here or a 6:06 PM Central instant renders as 11:06 PM.
 */
export function formatGoogleReviewsAdminTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIMEZONE,
  });
}
