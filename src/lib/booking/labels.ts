import type { FrequencyId } from "@/lib/pricing/types";
import type { PrepaidFrequency, TimeWindow } from "./types";

/**
 * Customer-facing frequency wording for booking/payment, per the approved
 * plan — "Every 2 Weeks"/"Every 4 Weeks", not src/lib/quote/frequency.ts's
 * getFrequencyLabel ("Biweekly"/"Monthly"), which is used elsewhere (quote
 * estimate heading, emails) and stays unchanged. Matches the wording
 * StepOneCleaning.tsx's own FREQUENCY_OPTIONS already use.
 */
export const NORMAL_FREQUENCY_LABELS: Record<FrequencyId, string> = {
  one_time: "One-Time",
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  every_4_weeks: "Every 4 Weeks",
};

export const PREPAID_FREQUENCY_LABELS: Record<PrepaidFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  every_4_weeks: "Every 4 Weeks",
};

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};
