import { describe, expect, it } from "vitest";
import { buildServiceAddressIdentity } from "./normalize-address";

describe("buildServiceAddressIdentity", () => {
  it("builds ZIP5 | STREET | UNIT", () => {
    expect(
      buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "Apt 4B" })
    ).toBe("75056|123 MAIN ST|APT 4B");
  });

  it("treats equivalent formatting (case, punctuation, extra whitespace) as the same identity", () => {
    const a = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St.", line2: "Apt. 4B" });
    const b = buildServiceAddressIdentity({ zip: "75056", line1: "  123   MAIN   ST  ", line2: "apt 4b" });
    expect(a).toBe(b);
  });

  it("accepts a ZIP+4 and uses only the first 5 digits", () => {
    const withPlus4 = buildServiceAddressIdentity({ zip: "75056-1234", line1: "123 Main St" });
    const zip5Only = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St" });
    expect(withPlus4).toBe(zip5Only);
  });

  it("gives different apartment units different identities at the same street", () => {
    const unitA = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "Apt 4B" });
    const unitB = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "Apt 4C" });
    expect(unitA).not.toBe(unitB);
  });

  it("distinguishes an address with no unit from one with a unit", () => {
    const noUnit = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St" });
    const withUnit = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "Apt 4B" });
    expect(noUnit).not.toBe(withUnit);
    expect(noUnit).toBe("75056|123 MAIN ST|");
  });

  it("treats a missing unit and an empty-string unit identically", () => {
    const omitted = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St" });
    const empty = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St", line2: "" });
    expect(omitted).toBe(empty);
  });

  it("returns null when the street line is blank — never falls back to ZIP alone", () => {
    expect(buildServiceAddressIdentity({ zip: "75056", line1: "" })).toBeNull();
    expect(buildServiceAddressIdentity({ zip: "75056", line1: "   " })).toBeNull();
  });

  it("returns null when the ZIP doesn't resolve to at least 5 digits", () => {
    expect(buildServiceAddressIdentity({ zip: "750", line1: "123 Main St" })).toBeNull();
    expect(buildServiceAddressIdentity({ zip: "", line1: "123 Main St" })).toBeNull();
  });

  it("differs across different ZIPs for the same street text", () => {
    const zipA = buildServiceAddressIdentity({ zip: "75056", line1: "123 Main St" });
    const zipB = buildServiceAddressIdentity({ zip: "75001", line1: "123 Main St" });
    expect(zipA).not.toBe(zipB);
  });
});
