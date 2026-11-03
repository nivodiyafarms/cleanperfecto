import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUnauthorizedError } from "@/lib/admin/require-admin";
import { AdminForbiddenError } from "@/lib/admin/rbac/capabilities";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/admin/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/require-admin")>();
  return { ...actual, requireAdmin: vi.fn() };
});

const adminSnapshot = vi.fn();
const issueAdminCode = vi.fn();
const referralCodeType = vi.fn();
const updateRecipientLabel = vi.fn();
const setCodeActive = vi.fn();

vi.mock("@/lib/referrals/supabase-referral-repository", () => ({
  createSupabaseReferralRepository: () => ({
    adminSnapshot,
    issueAdminCode,
    referralCodeType,
    updateRecipientLabel,
    setCodeActive,
  }),
}));

const { requireAdmin } = await import("@/lib/admin/require-admin");
const { revalidatePath } = await import("next/cache");
const {
  issueAdminReferralCodeAction,
  loadAdminReferralSnapshot,
  updateReferralCodeRecipientLabelAction,
} = await import("./referral-actions");

function formData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

function mockOwner() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "admin-1", supabaseUserId: "user-1", role: "owner_admin" });
}

function mockOperations() {
  vi.mocked(requireAdmin).mockResolvedValue({ adminUserId: "ops-1", supabaseUserId: "user-ops", role: "operations" });
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
  adminSnapshot.mockReset();
  issueAdminCode.mockReset();
  referralCodeType.mockReset();
  updateRecipientLabel.mockReset();
  setCodeActive.mockReset();
  vi.mocked(revalidatePath).mockReset();
  issueAdminCode.mockResolvedValue("K7P3NQ2M");
  referralCodeType.mockResolvedValue("admin_issued");
  updateRecipientLabel.mockResolvedValue(undefined);
  adminSnapshot.mockResolvedValue({ codes: [] });
});

describe("loadAdminReferralSnapshot", () => {
  it("loads referrals for an owner", async () => {
    mockOwner();
    await expect(loadAdminReferralSnapshot()).resolves.toEqual({ codes: [] });
    expect(adminSnapshot).toHaveBeenCalledOnce();
  });

  it("rejects an unauthorized read before loading referrals", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
    await expect(loadAdminReferralSnapshot()).rejects.toThrow(AdminUnauthorizedError);
    expect(adminSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an operations read before loading referrals", async () => {
    mockOperations();
    await expect(loadAdminReferralSnapshot()).rejects.toThrow(AdminForbiddenError);
    expect(adminSnapshot).not.toHaveBeenCalled();
  });
});

describe("issueAdminReferralCodeAction", () => {
  it("issues a Type B code with the server admin id and a trimmed label", async () => {
    mockOwner();
    const result = await issueAdminReferralCodeAction(null, formData({ recipientLabel: "  Ada Lovelace  ", adminUserId: "forged" }));
    expect(result).toEqual({ ok: true, message: "Issued code K7P3NQ2M." });
    expect(issueAdminCode).toHaveBeenCalledWith("admin-1", "Ada Lovelace");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/referrals");
  });

  it("stores a blank label as null", async () => {
    mockOwner();
    const result = await issueAdminReferralCodeAction(null, formData({ recipientLabel: "   " }));
    expect(result.ok).toBe(true);
    expect(issueAdminCode).toHaveBeenCalledWith("admin-1", null);
  });

  it("rejects a label over 120 characters before writing", async () => {
    mockOwner();
    const result = await issueAdminReferralCodeAction(null, formData({ recipientLabel: "a".repeat(121) }));
    expect(result).toEqual({ ok: false, error: "Given to must be 120 characters or fewer." });
    expect(issueAdminCode).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized write before issuing a code", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
    await expect(issueAdminReferralCodeAction(null, formData({ recipientLabel: "Ada" }))).rejects.toThrow(AdminUnauthorizedError);
    expect(issueAdminCode).not.toHaveBeenCalled();
  });

  it("rejects an operations write before issuing a code", async () => {
    mockOperations();
    await expect(issueAdminReferralCodeAction(null, formData({ recipientLabel: "Ada", adminUserId: "forged" }))).rejects.toThrow(
      AdminForbiddenError,
    );
    expect(issueAdminCode).not.toHaveBeenCalled();
  });
});

describe("updateReferralCodeRecipientLabelAction", () => {
  it("saves a trimmed label with the server admin id", async () => {
    mockOwner();
    const result = await updateReferralCodeRecipientLabelAction(
      null,
      formData({ codeId: "code-1", recipientLabel: "  Ada Lovelace  ", adminUserId: "forged" }),
    );
    expect(result).toEqual({ ok: true, message: "Recipient updated." });
    expect(referralCodeType).toHaveBeenCalledWith("code-1");
    expect(updateRecipientLabel).toHaveBeenCalledWith("code-1", "admin-1", "Ada Lovelace");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/referrals");
  });

  it("clears a blank label to null", async () => {
    mockOwner();
    const result = await updateReferralCodeRecipientLabelAction(null, formData({ codeId: "code-1", recipientLabel: "  " }));
    expect(result.ok).toBe(true);
    expect(updateRecipientLabel).toHaveBeenCalledWith("code-1", "admin-1", null);
  });

  it("rejects a Type A code before writing", async () => {
    mockOwner();
    referralCodeType.mockResolvedValue("customer");
    const result = await updateReferralCodeRecipientLabelAction(null, formData({ codeId: "code-a", recipientLabel: "Ada" }));
    expect(result).toEqual({ ok: false, error: "A recipient can only be recorded on a Type B code." });
    expect(updateRecipientLabel).not.toHaveBeenCalled();
  });

  it("rejects a label over 120 characters before reading or writing", async () => {
    mockOwner();
    const result = await updateReferralCodeRecipientLabelAction(null, formData({ codeId: "code-1", recipientLabel: "a".repeat(121) }));
    expect(result.ok).toBe(false);
    expect(referralCodeType).not.toHaveBeenCalled();
    expect(updateRecipientLabel).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized read and write before touching a code", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AdminUnauthorizedError());
    await expect(
      updateReferralCodeRecipientLabelAction(null, formData({ codeId: "code-1", recipientLabel: "Ada", adminUserId: "forged" })),
    ).rejects.toThrow(AdminUnauthorizedError);
    expect(referralCodeType).not.toHaveBeenCalled();
    expect(updateRecipientLabel).not.toHaveBeenCalled();
  });

  it("rejects an operations write before touching a code", async () => {
    mockOperations();
    await expect(updateReferralCodeRecipientLabelAction(null, formData({ codeId: "code-1", recipientLabel: "Ada" }))).rejects.toThrow(
      AdminForbiddenError,
    );
    expect(referralCodeType).not.toHaveBeenCalled();
    expect(updateRecipientLabel).not.toHaveBeenCalled();
  });
});
