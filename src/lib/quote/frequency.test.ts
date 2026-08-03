import { describe, expect, it } from "vitest";
import {
  FREQUENCIES,
  getFrequencyLabel,
  isRecurringFrequency,
} from "@/lib/quote/frequency";

describe("frequency labels", () => {
  it("maps every internal id to its approved customer-facing label", () => {
    expect(FREQUENCIES).toEqual([
      { id: "one_time", label: "One-time" },
      { id: "weekly", label: "Weekly" },
      { id: "biweekly", label: "Biweekly" },
      { id: "every_4_weeks", label: "Monthly" },
    ]);
  });

  it("getFrequencyLabel resolves known ids and falls back to the raw value", () => {
    expect(getFrequencyLabel("weekly")).toBe("Weekly");
    expect(getFrequencyLabel("every_4_weeks")).toBe("Monthly");
    expect(getFrequencyLabel("unknown")).toBe("unknown");
  });

  it("only one_time is treated as non-recurring", () => {
    expect(isRecurringFrequency("one_time")).toBe(false);
    expect(isRecurringFrequency("weekly")).toBe(true);
    expect(isRecurringFrequency("biweekly")).toBe(true);
    expect(isRecurringFrequency("every_4_weeks")).toBe(true);
  });
});
