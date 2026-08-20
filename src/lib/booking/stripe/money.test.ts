import { describe, expect, it } from "vitest";
import { toStripeCents } from "./money";

describe("toStripeCents", () => {
  it("converts whole and simple decimal dollar amounts exactly", () => {
    expect(toStripeCents(99)).toBe(9900);
    expect(toStripeCents(179.5)).toBe(17950);
  });

  it("is exact for float-risk amounts that naive multiplication mishandles", () => {
    expect(toStripeCents(700.01)).toBe(70001);
    expect(toStripeCents(116.67)).toBe(11667);
    expect(toStripeCents(0.29)).toBe(29);
  });
});
