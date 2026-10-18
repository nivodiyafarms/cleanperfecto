"use client";

import { useMemo, useState } from "react";
import ActionForm from "@/components/admin/ActionForm";
import { recordCashOrZellePaymentAction } from "@/lib/admin/actions/payment-actions";

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Admin's direct, self-contained "Record Cash/Zelle Payment Received" form
 * — opening it (rendering these props) has zero side effects, since
 * `preview` comes from previewServiceAmountAndTax (a read-only Stripe Tax
 * preview, no DB write at all — see the page's own server-side call).
 * Nothing is written until this form is actually submitted, at which
 * point recordCashOrZellePaymentAction runs the full audited
 * recordCashOrZellePayment flow server-side.
 *
 * The live "expected total" shown here (service + tax preview + tip) is a
 * convenience for the admin's own double-entry confirmation — it is never
 * sent to the server and never trusted as the authoritative amount; the
 * server independently recomputes the real total (via a fresh
 * selectVisitTip call) and rejects the submission if the admin's typed
 * Total Received doesn't match it to the cent.
 */
export default function RecordCashZellePaymentForm({
  serviceVisitId,
  preview,
}: {
  serviceVisitId: string;
  preview: { serviceAmount: number; taxAmount: number; previewTotal: number };
}) {
  const [tipAmount, setTipAmount] = useState("0");

  const expectedTotal = useMemo(() => {
    const tip = Number(tipAmount);
    if (!Number.isFinite(tip) || tip < 0) return preview.previewTotal;
    return preview.previewTotal + tip;
  }, [tipAmount, preview.previewTotal]);

  return (
    <ActionForm action={recordCashOrZellePaymentAction} className="mt-3 space-y-3">
      <input type="hidden" name="serviceVisitId" value={serviceVisitId} />
      <dl className="space-y-1 text-xs text-muted">
        <div>Service/extras: {formatMoney(preview.serviceAmount)}</div>
        <div>Tax (estimate, no tip): {formatMoney(preview.taxAmount)}</div>
        <div className="text-foreground">
          Expected total (service + tax + tip): <span className="font-semibold">{formatMoney(expectedTotal)}</span>
        </div>
        <div className="italic">This preview is for your reference only — the actual total (including final tax on the tip) is computed server-side when you submit.</div>
      </dl>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-muted" htmlFor={`${serviceVisitId}-paymentMethodType`}>
            Method
          </label>
          <select id={`${serviceVisitId}-paymentMethodType`} name="paymentMethodType" className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm">
            <option value="zelle">Zelle</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted" htmlFor={`${serviceVisitId}-tipAmount`}>
            Tip received
          </label>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-sm text-muted">$</span>
            <input
              id={`${serviceVisitId}-tipAmount`}
              name="tipAmount"
              type="number"
              min="0"
              step="0.01"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              required
              className="w-24 rounded-lg border border-border px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted" htmlFor={`${serviceVisitId}-totalReceivedConfirmation`}>
            Total received (confirm)
          </label>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-sm text-muted">$</span>
            <input
              id={`${serviceVisitId}-totalReceivedConfirmation`}
              name="totalReceivedConfirmation"
              type="number"
              min="0"
              step="0.01"
              required
              className="w-28 rounded-lg border border-border px-2 py-1 text-sm"
            />
          </div>
        </div>
        <input name="externalPaymentReference" type="text" placeholder="Reference (optional)" className="rounded-lg border border-border px-3 py-1.5 text-sm" />
        <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt">
          Record Cash/Zelle Payment
        </button>
      </div>
    </ActionForm>
  );
}
