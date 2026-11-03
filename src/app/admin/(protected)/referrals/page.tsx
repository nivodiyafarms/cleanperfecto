import ActionForm from "@/components/admin/ActionForm";
import {
  issueAdminReferralCodeAction,
  loadAdminReferralSnapshot,
  setReferralCodeActiveAction,
  updateReferralCodeRecipientLabelAction,
} from "@/lib/admin/actions/referral-actions";
import { AdminForbiddenError } from "@/lib/admin/rbac/capabilities";

export default async function AdminReferralsPage() {
  let snapshot;
  try {
    snapshot = await loadAdminReferralSnapshot();
  } catch (error) {
    if (error instanceof AdminForbiddenError) {
      return <p className="text-sm text-foreground">You don&apos;t have access to the referral program.</p>;
    }
    throw error;
  }

  const reversals = snapshot.credits.filter((credit) => credit.status === "voided" || credit.status === "review");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Referrals</h1>
        <p className="mt-1 text-sm text-muted">Issue or disable owner codes. Customer codes stay one per customer.</p>
      </div>

      <ActionForm action={issueAdminReferralCodeAction} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm text-foreground">
            Given to
            <input
              name="recipientLabel"
              maxLength={120}
              autoComplete="off"
              placeholder="Optional"
              className="mt-1 block w-full max-w-xs rounded-lg border border-border px-2 py-1 text-sm"
            />
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-foreground">
            Issue Type B code
          </button>
        </div>
      </ActionForm>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Codes</h2>
        <ul className="mt-3 divide-y divide-border">
          {snapshot.codes.map((code) => (
            <li key={code.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <span className="font-mono tracking-wide">
                  {code.code} · {code.codeType === "admin_issued" ? "Type B" : "Type A"} · {code.active ? "active" : "disabled"}
                </span>
                {code.codeType === "admin_issued" ? (
                  <p className="mt-1 text-muted">Given to: {code.recipientLabel ?? "—"}</p>
                ) : null}
              </div>
              {code.codeType === "admin_issued" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={updateReferralCodeRecipientLabelAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="codeId" value={code.id} />
                    <label className="text-sm text-muted" htmlFor={`recipient-${code.id}`}>
                      Given to
                    </label>
                    <input
                      id={`recipient-${code.id}`}
                      name="recipientLabel"
                      defaultValue={code.recipientLabel ?? ""}
                      maxLength={120}
                      autoComplete="off"
                      className="w-40 rounded-lg border border-border px-2 py-1 text-sm"
                    />
                    <button type="submit" className="min-h-11 rounded-full border border-border px-3 text-sm">
                      Save
                    </button>
                  </ActionForm>
                  <ActionForm action={setReferralCodeActiveAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="codeId" value={code.id} />
                    <input type="hidden" name="active" value={code.active ? "false" : "true"} />
                    <input name="reason" placeholder="Reason" className="rounded-lg border border-border px-2 py-1 text-sm" />
                    <button type="submit" className="min-h-11 rounded-full border border-border px-3 text-sm">
                      {code.active ? "Disable" : "Enable"}
                    </button>
                  </ActionForm>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Attribution</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {snapshot.referrals.map((referral) => (
            <li key={referral.id} className="rounded-xl border border-border px-3 py-2">
              {referral.codeType === "admin_issued" ? "Type B" : "Type A"} · friend {referral.referredCustomerId} · {referral.status}
              {referral.reviewFlags.length > 0 ? ` · flags ${referral.reviewFlags.join(", ")}` : ""}
              {referral.qualifyingServiceVisitId ? ` · visit ${referral.qualifyingServiceVisitId}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Credits</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {snapshot.credits.map((credit) => (
            <li key={credit.id} className="rounded-xl border border-border px-3 py-2">
              ${credit.amount.toFixed(2)} · {credit.beneficiaryRole} · {credit.status} · expires {credit.expiresAt}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Redemptions</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {snapshot.redemptions.map((redemption) => (
            <li key={redemption.id} className="rounded-xl border border-border px-3 py-2">
              ${redemption.amount.toFixed(2)} on visit {redemption.serviceVisitId} · eligible ${redemption.eligibleCleaningAmount.toFixed(2)} · {redemption.status}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Reversals and review</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {reversals.map((credit) => (
            <li key={credit.id} className="rounded-xl border border-border px-3 py-2">
              {credit.status} · {credit.beneficiaryRole} · referral {credit.referralId}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground">Audit</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {snapshot.audits.map((audit) => (
            <li key={audit.id} className="rounded-xl border border-border px-3 py-2">
              {audit.createdAt} · {audit.actionType} · {audit.targetId}
              {audit.reason ? ` · ${audit.reason}` : ""}
              {audit.actionType === "recipient_label_updated" ? ` · ${audit.previousValue ?? "—"} → ${audit.newValue ?? "—"}` : ""}
              {audit.actionType === "code_issued" && audit.newValue ? ` · given to ${audit.newValue}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
