export type FrequencyId = "one_time" | "weekly" | "biweekly" | "every_4_weeks";

export interface Frequency {
  id: FrequencyId;
  label: string;
}

// Customer-facing labels per the approved direction: "One-time, weekly,
// biweekly, or monthly cleaning options available." Internal ids are
// unchanged; only display wording is defined here.
export const FREQUENCIES: Frequency[] = [
  { id: "one_time", label: "One-time" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Biweekly" },
  { id: "every_4_weeks", label: "Monthly" },
];

export const DEFAULT_FREQUENCY_ID: FrequencyId = "one_time";

export function getFrequencyLabel(id: string): string {
  const match = FREQUENCIES.find((frequency) => frequency.id === id);
  return match ? match.label : id;
}

export function isRecurringFrequency(id: FrequencyId): boolean {
  return id !== "one_time";
}
