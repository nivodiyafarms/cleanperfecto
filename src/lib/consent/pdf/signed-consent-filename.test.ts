import { describe, expect, it } from "vitest";
import { buildSignedConsentDocumentPath, buildSignedConsentFilename } from "./signed-consent-filename";

describe("buildSignedConsentFilename", () => {
  it("matches the approved pattern using the immutable signed_name", () => {
    const filename = buildSignedConsentFilename({
      signedName: "Christine Smith",
      consentVersionLabel: "CP-CONSENT-2026-01",
      signedAt: new Date("2026-08-24T15:04:05.000Z"),
    });
    expect(filename).toBe("CleanPerfecto_Consent_Christine_Smith_CP-CONSENT-2026-01_2026-08-24.pdf");
  });

  it("sanitizes special characters and collapses them to underscores", () => {
    const filename = buildSignedConsentFilename({
      signedName: "O'Brien-Smith Jr.",
      consentVersionLabel: "CP-CONSENT-2026-01",
      signedAt: new Date("2026-08-24T00:00:00.000Z"),
    });
    expect(filename).toBe("CleanPerfecto_Consent_O_Brien_Smith_Jr_CP-CONSENT-2026-01_2026-08-24.pdf");
  });

  it("never includes email or phone — only signedName, version, and date are inputs", () => {
    const filename = buildSignedConsentFilename({
      signedName: "Jane Doe",
      consentVersionLabel: "CP-CONSENT-2026-01",
      signedAt: new Date("2026-08-24T00:00:00.000Z"),
    });
    expect(filename).not.toMatch(/@/);
    expect(filename).not.toMatch(/\d{3}[-.]?\d{3}[-.]?\d{4}/);
  });

  it("falls back to a safe default when the name sanitizes to nothing", () => {
    const filename = buildSignedConsentFilename({ signedName: "***", consentVersionLabel: "CP-CONSENT-2026-01", signedAt: new Date("2026-08-24T00:00:00.000Z") });
    expect(filename).toBe("CleanPerfecto_Consent_Customer_CP-CONSENT-2026-01_2026-08-24.pdf");
  });

  it("uses the name as supplied — the caller (sign-consent.ts / retry-signed-consent-document.ts) is what guarantees this is always the frozen signed_name, never a current/profile name; there is no separate 'profile name' parameter for this function to ever pick up", () => {
    const signedAtTheTime = buildSignedConsentFilename({ signedName: "Christine Smith", consentVersionLabel: "CP-CONSENT-2026-01", signedAt: new Date("2026-08-24T00:00:00.000Z") });
    const hypotheticalCurrentProfileName = buildSignedConsentFilename({ signedName: "Christine Jones", consentVersionLabel: "CP-CONSENT-2026-01", signedAt: new Date("2026-08-24T00:00:00.000Z") });
    expect(signedAtTheTime).toContain("Christine_Smith");
    expect(hypotheticalCurrentProfileName).not.toBe(signedAtTheTime); // proves the function is name-sensitive, not silently ignoring its input
  });
});

describe("buildSignedConsentDocumentPath", () => {
  it("nests the file under the customer's own UUID folder", () => {
    const path = buildSignedConsentDocumentPath("customer-1", "CleanPerfecto_Consent_Jane_Doe_CP-CONSENT-2026-01_2026-08-24.pdf");
    expect(path).toBe("customer-1/CleanPerfecto_Consent_Jane_Doe_CP-CONSENT-2026-01_2026-08-24.pdf");
  });
});
