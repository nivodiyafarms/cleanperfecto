import { describe, expect, it, vi } from "vitest";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { GET } = await import("./route");

/**
 * Regression test for a genuine bug found during Consent + Review
 * Automation V1 disposable-Postgres validation: an authenticated
 * non-admin hitting this route left AdminUnauthorizedError uncaught,
 * surfacing a generic 500 instead of a clean denial (a Route Handler has
 * no error.tsx boundary the way a page does). Access was never actually
 * granted — this only affects the HTTP status/clarity of the denial.
 */
describe("GET /admin/consent/[consentId]/document — authorization", () => {
  it("maps an authenticated non-admin (AdminUnauthorizedError) to a clean 403, not an uncaught 500", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());

    const response = await GET(new Request("http://localhost/admin/consent/consent-1/document"), { params: Promise.resolve({ consentId: "consent-1" }) });

    expect(response.status).toBe(403);
  });
});
