import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_CONSENT_TEMPLATE } from "./service-consent-template";

describe("SERVICE_CONSENT_TEMPLATE", () => {
  it("matches the seeded CP-CONSENT-2026-01 agreement and stays pending legal review", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260827090000_create_consent_versions.sql"),
      "utf8",
    );

    expect(SERVICE_CONSENT_TEMPLATE.versionLabel).toBe("CP-CONSENT-2026-01");
    expect(SERVICE_CONSENT_TEMPLATE.title).toBe("CleanPerfecto Service Consent Agreement");
    expect(SERVICE_CONSENT_TEMPLATE.isLegallyReviewed).toBe(false);
    expect(sql.replace(/\r\n/g, "\n")).toContain(SERVICE_CONSENT_TEMPLATE.bodyText);
    expect(sql).toContain("is_legally_reviewed boolean not null default false");
  });
});
