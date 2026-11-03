import { describe, expect, it } from "vitest";
import { normalizeClientIp } from "./normalize-client-ip";

describe("normalizeClientIp", () => {
  it("trims and lowercases", () => {
    expect(normalizeClientIp("  203.0.113.9  ")).toBe("203.0.113.9");
    expect(normalizeClientIp("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("strips IPv6 brackets and zone ids", () => {
    expect(normalizeClientIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeClientIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeClientIp("[fe80::1%25eth0]")).toBe("fe80::1");
  });

  it("maps IPv4-mapped IPv6 to IPv4", () => {
    expect(normalizeClientIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeClientIp("::FFFF:198.51.100.7")).toBe("198.51.100.7");
  });
});
