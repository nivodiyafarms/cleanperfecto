"use client";

import { useEffect, useId, useRef } from "react";

interface TermsConsentDialogProps {
  /** Controlled from the parent's "View Terms & Consent" trigger. */
  open: boolean;
  onClose: () => void;
  serviceTermsTitle: string;
  serviceTermsBody: string;
  isLegallyReviewed: boolean;
  cancellationPolicyTiers: { window: string; fee: string }[];
  /** Payment-authorization explanation — worded per payment model (Pay Per Cleaning vs Prepaid Package) by the caller. */
  paymentAuthorizationCopy: string;
  packageCancellationNote?: string;
}

/**
 * Read-only "View Terms & Consent" content, rendered in a native <dialog>
 * so ESC-to-close and focus containment come from the browser itself
 * rather than a hand-rolled focus trap. Deliberately has NO accept/agree
 * action inside it — the required checkbox lives outside, in the caller,
 * and is never affected by opening or closing this dialog (closing it,
 * including via ESC or the backdrop, can never itself count as
 * acceptance).
 */
export default function TermsConsentDialog({
  open,
  onClose,
  serviceTermsTitle,
  serviceTermsBody,
  isLegallyReviewed,
  cancellationPolicyTiers,
  paymentAuthorizationCopy,
  packageCancellationNote,
}: TermsConsentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      className="w-full max-w-lg rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-foreground/40 open:animate-none"
    >
      <div className="max-h-[80vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            Terms &amp; Consent
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-9 min-w-9 rounded-full text-muted hover:bg-background-alt hover:text-foreground"
          >
            ×
          </button>
        </div>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-foreground">{serviceTermsTitle}</h3>
          {!isLegallyReviewed && (
            <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Business template — pending legal review.</p>
          )}
          <div className="mt-2 rounded-xl bg-background-alt p-3 text-sm whitespace-pre-wrap text-foreground">{serviceTermsBody}</div>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-semibold text-foreground">Cancellation &amp; Rescheduling Policy</h3>
          <ul className="mt-2 flex flex-col gap-1 rounded-xl bg-background-alt p-3 text-xs text-muted">
            {cancellationPolicyTiers.map((tier) => (
              <li key={tier.window}>
                <span className="text-foreground">{tier.window}:</span> {tier.fee}
              </li>
            ))}
          </ul>
          {packageCancellationNote && <p className="mt-2 text-xs text-muted">{packageCancellationNote}</p>}
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-semibold text-foreground">Payment Authorization</h3>
          <p className="mt-2 text-sm text-muted">{paymentAuthorizationCopy}</p>
        </section>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground hover:bg-background-alt sm:w-auto"
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
