import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeConsentRepository } from "@/lib/consent/test-support/fake-consent-repository";
import { createFakeSchedulingRepository } from "@/lib/scheduling/test-support/fake-scheduling-repository";

let fakeConsent: ReturnType<typeof createFakeConsentRepository>;
let fakeScheduling: ReturnType<typeof createFakeSchedulingRepository>;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "test-agent" })),
}));

vi.mock("@/lib/customer-portal/require-customer", () => ({
  requireCustomer: vi.fn(),
}));

vi.mock("@/lib/consent/consent-repository", () => ({
  createSupabaseConsentRepository: () => fakeConsent.repo,
}));

vi.mock("@/lib/scheduling/supabase-scheduling-repository", () => ({
  createSupabaseSchedulingRepository: () => fakeScheduling.repo,
}));

const { requireCustomer } = await import("@/lib/customer-portal/require-customer");
const { signConsentAction, declineConsentAction } = await import("./consent-actions");

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  fakeConsent = createFakeConsentRepository();
  fakeScheduling = createFakeSchedulingRepository();
  vi.mocked(requireCustomer).mockReset();
  vi.mocked(requireCustomer).mockResolvedValue({ customerAccountId: "account-1", customerId: "customer-1", supabaseUserId: "user-1" });
});

describe("signConsentAction — portal fallback clickwrap acceptance", () => {
  it("rejects when the checkbox was not checked (4)", async () => {
    const result = await signConsentAction(null, formData({ agreedToTerms: "false", consentVersionId: "version-1" }));
    expect(result.ok).toBe(false);
  });

  it("rejects when no consent template version is supplied (5, 9)", async () => {
    const result = await signConsentAction(null, formData({ agreedToTerms: "true", consentVersionId: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a fake/arbitrary template id that isn't the active version (9)", async () => {
    const result = await signConsentAction(null, formData({ agreedToTerms: "true", consentVersionId: "not-the-active-version" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a valid checkbox + the actual active version id, without any typed name field (6, 17)", async () => {
    const result = await signConsentAction(null, formData({ agreedToTerms: "true", consentVersionId: "version-1" }));
    expect(result.ok).toBe(true);

    const record = await fakeConsent.repo.findByCustomerAndVersion("customer-1", "version-1");
    expect(record?.state).toBe("signed");
  });

  it("is idempotent on retry — resubmitting after already-accepted returns ok without creating a duplicate (11)", async () => {
    await signConsentAction(null, formData({ agreedToTerms: "true", consentVersionId: "version-1" }));
    const second = await signConsentAction(null, formData({ agreedToTerms: "true", consentVersionId: "version-1" }));

    expect(second.ok).toBe(true);
    expect([...fakeConsent.state.consents.values()].filter((c) => c.customerId === "customer-1")).toHaveLength(1);
  });
});

describe("declineConsentAction", () => {
  it("propagates when the customer session cannot be resolved (requireCustomer redirects/throws for an unauthenticated request)", async () => {
    vi.mocked(requireCustomer).mockRejectedValue(new Error("redirect"));
    await expect(declineConsentAction(null, formData({}))).rejects.toThrow();
  });
});
