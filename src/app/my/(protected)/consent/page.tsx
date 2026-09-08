import ActionForm from "@/components/admin/ActionForm";
import { declineConsentAction, signConsentAction } from "@/lib/customer-portal/actions/consent-actions";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { recordConsentViewed } from "@/lib/consent/record-consent-viewed";

export default async function MyConsentPage() {
  const session = await requireCustomer();
  const consentRepo = createSupabaseConsentRepository();

  const activeVersion = await consentRepo.findActiveVersion();

  if (!activeVersion) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-foreground">Service Authorization</h1>
        <p className="mt-2 text-sm text-muted">No consent form is currently active. Please check back later.</p>
      </div>
    );
  }

  const record = await consentRepo.findByCustomerAndVersion(session.customerId, activeVersion.id);
  if (record && record.state === "sent") {
    await recordConsentViewed(consentRepo, session.customerId);
  }

  if (record?.state === "signed") {
    return (
      <div className="max-w-2xl space-y-6">
        <h1 className="text-xl font-semibold text-foreground">Service Authorization</h1>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm font-medium text-emerald-700">Accepted</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs font-medium text-muted">Version</dt>
              <dd className="text-foreground">{activeVersion.versionLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted">Accepted at</dt>
              <dd className="text-foreground">{record.signedAt?.toLocaleString()}</dd>
            </div>
          </dl>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-muted">View Accepted Agreement</summary>
            <div className="mt-2 rounded-lg bg-background-alt p-3 text-sm whitespace-pre-wrap text-foreground">{record.acceptedTextSnapshot}</div>
          </details>
          {record.signedDocumentPath && (
            <div className="mt-3">
              <a href="/my/consent/document" className="text-sm font-medium text-secondary hover:underline">
                Download PDF
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-foreground">{activeVersion.title}</h1>
      {!activeVersion.isLegallyReviewed && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Business template ({activeVersion.versionLabel}) — pending legal review.
        </p>
      )}
      {record?.state === "declined" && (
        <p className="rounded-lg bg-background-alt px-3 py-2 text-sm text-muted">You previously declined. You can review and accept below at any time.</p>
      )}

      <div className="rounded-2xl border border-border bg-surface p-5 text-sm whitespace-pre-wrap text-foreground">{activeVersion.bodyText}</div>

      <ActionForm action={signConsentAction} className="rounded-2xl border border-border bg-surface p-5 space-y-4">
        <input type="hidden" name="consentVersionId" value={activeVersion.id} />
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" name="agreedToTerms" value="true" required className="mt-0.5" />
          <span>I agree to the CleanPerfecto Service Consent Agreement.</span>
        </label>

        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          Accept
        </button>
      </ActionForm>

      <ActionForm action={declineConsentAction}>
        <button type="submit" className="text-sm font-medium text-muted hover:text-foreground">
          Decline for now
        </button>
      </ActionForm>
    </div>
  );
}
