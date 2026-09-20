import { utcToZonedDateTime } from "@/lib/scheduling/timezone";

const DISPLAY_TIMEZONE = "America/Chicago";

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** "10:00 AM" from a 24-hour "HH:MM". */
export function formatTimeOfDay(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${period}`;
}

/** Formats a stored UTC ISO instant as a local ("America/Chicago") "Mon, Sep 8 · 10:00 AM" string. */
export function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  const { date, time } = utcToZonedDateTime(new Date(iso), DISPLAY_TIMEZONE);
  const [year, month, day] = date.split("-").map(Number);
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${label} · ${formatTimeOfDay(time)}`;
}

/** Just the local "HH:MM" (24-hour) part of a stored UTC ISO instant — useful for form default values. */
export function localTimeOf(iso: string): string {
  return utcToZonedDateTime(new Date(iso), DISPLAY_TIMEZONE).time;
}

/** Just the local "YYYY-MM-DD" date part of a stored UTC ISO instant. */
export function localDateOf(iso: string): string {
  return utcToZonedDateTime(new Date(iso), DISPLAY_TIMEZONE).date;
}

export function formatVisitStatusLabel(status: string): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "scheduled":
      return "Scheduled";
    case "work_finished":
      return "Work Finished";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function formatCadenceLabel(frequency: string | null): string {
  switch (frequency) {
    case "one_time":
      return "One-Time";
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 Weeks";
    case "every_4_weeks":
      return "Every 4 Weeks";
    default:
      return frequency ?? "—";
  }
}
