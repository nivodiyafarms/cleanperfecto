import { describe, expect, it } from "vitest";
import { assertCustomerOwnsDocumentPath, ConsentDocumentAccessError } from "./authorize-document-access";

describe("assertCustomerOwnsDocumentPath", () => {
  it("allows a path nested under the requesting customer's own folder", () => {
    expect(() => assertCustomerOwnsDocumentPath("customer-1", "customer-1/CleanPerfecto_Consent_Jane_Doe_CP-CONSENT-2026-01_2026-08-24.pdf")).not.toThrow();
  });

  it("rejects a path belonging to a different customer — the customer-cannot-download-another-customer's-PDF guarantee", () => {
    expect(() => assertCustomerOwnsDocumentPath("customer-1", "customer-2/CleanPerfecto_Consent_Someone_Else_CP-CONSENT-2026-01_2026-08-24.pdf")).toThrow(ConsentDocumentAccessError);
  });

  it("rejects a path that merely starts with the customer id as a string prefix but isn't actually nested under it (e.g. customer-10 vs customer-1)", () => {
    expect(() => assertCustomerOwnsDocumentPath("customer-1", "customer-10/some-file.pdf")).toThrow(ConsentDocumentAccessError);
  });
});
