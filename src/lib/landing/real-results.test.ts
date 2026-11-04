import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FACEBOOK_URL, REAL_RESULTS, REAL_RESULTS_HEADING, TIKTOK_URL, pickActiveIndex } from "./real-results";

describe("real results content", () => {
  it("has the approved heading, captions and links", () => {
    expect(REAL_RESULTS_HEADING).toBe("Real homes. Real results.");
    expect(REAL_RESULTS.map((r) => r.caption)).toEqual([
      "Glass stovetop · Deep clean",
      "Shower glass · Soap scum removal",
      "Bathtub · Deep cleaning",
    ]);
    expect(TIKTOK_URL).toBe("https://www.tiktok.com/@cleanperfecto6");
    expect(FACEBOOK_URL).toBe("https://www.facebook.com/share/1DTNrpKxMc/");
  });

  it("points at media files that exist in public/", () => {
    for (const r of REAL_RESULTS) {
      expect(existsSync(path.join(process.cwd(), "public", r.src))).toBe(true);
      expect(existsSync(path.join(process.cwd(), "public", r.poster))).toBe(true);
    }
  });
});

describe("pickActiveIndex", () => {
  it("returns null when nothing is visible enough", () => {
    expect(pickActiveIndex([0, 0.3, 0.59])).toBeNull();
  });
  it("picks the most visible card", () => {
    expect(pickActiveIndex([0.7, 0.95, 0.2])).toBe(1);
  });
});
