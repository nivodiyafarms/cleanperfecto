"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createAndSendAgreedQuoteAction } from "@/lib/admin/actions/agreed-quote-actions";
import type { ActionResult } from "@/lib/admin/actions/types";

const ADD_ON_OPTIONS: { id: string; label: string }[] = [
  { id: "inside_oven", label: "Oven Interior" },
  { id: "inside_refrigerator", label: "Refrigerator Interior" },
  { id: "refrigerator_oven_bundle", label: "Refrigerator + Oven Bundle" },
  { id: "inside_cabinets_drawers", label: "Inside Cabinets & Drawers (starting at)" },
  { id: "extra_pet_hair_removal", label: "Extra Pet Hair Removal (starting at)" },
  { id: "carpet_shampooing", label: "Carpet Shampooing (manual quote)" },
  { id: "heavy_organization", label: "Heavy Organization (manual quote)" },
  { id: "additional_interior_window_detailing", label: "Additional Interior Window Detailing (manual quote)" },
  { id: "boxing_packing", label: "Boxing & Packing (manual quote)" },
];

export interface AgreedQuoteFormProps {
  existingCustomerId?: string;
  existingCustomerName?: string;
  existingCustomerEmail?: string | null;
  supersedesInvitationId?: string;
}

/**
 * This review-step requirement is intentionally implemented as a single
 * confirm-and-send form with every value visible on the page before
 * submission, rather than a separate preview screen — a deliberate scope
 * simplification; the server action (createAndSendAgreedQuoteAction) still
 * independently re-validates/re-checks the reference price before writing
 * anything, so no authorization or correctness guarantee depends on this
 * UI step.
 */
export default function AgreedQuoteForm({ existingCustomerId, existingCustomerName, existingCustomerEmail, supersedesInvitationId }: AgreedQuoteFormProps) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(createAndSendAgreedQuoteAction, null);

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {supersedesInvitationId && <input type="hidden" name="supersedesInvitationId" value={supersedesInvitationId} />}

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Customer</h2>
        {existingCustomerId ? (
          <>
            <input type="hidden" name="existingCustomerId" value={existingCustomerId} />
            <p className="mt-2 text-sm text-foreground">
              {existingCustomerName} <span className="text-muted">({existingCustomerEmail ?? "no email on file"})</span>
            </p>
            <Link href="/admin/agreed-quotes/new" className="mt-1 inline-block text-xs text-secondary hover:underline">
              Change customer
            </Link>
          </>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <input name="newCustomerName" placeholder="Full name" required className="rounded-lg border border-border px-3 py-2 text-sm" />
            <input name="newCustomerEmail" type="email" placeholder="Email (required)" required className="rounded-lg border border-border px-3 py-2 text-sm" />
            <input name="newCustomerPhone" placeholder="Phone (optional)" className="rounded-lg border border-border px-3 py-2 text-sm" />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Negotiation</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <select name="negotiationChannel" defaultValue="" className="rounded-lg border border-border px-3 py-2 text-sm">
            <option value="">Negotiated via…</option>
            <option value="facebook">Facebook</option>
            <option value="marketplace">Marketplace</option>
            <option value="phone">Phone</option>
            <option value="text">Text</option>
            <option value="email">Email</option>
            <option value="other">Other</option>
          </select>
          <input name="negotiationNotes" placeholder="Notes (optional)" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Agreed scope</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <select name="propertyType" defaultValue="home" className="rounded-lg border border-border px-3 py-2 text-sm">
            <option value="home">Home</option>
            <option value="apartment">Apartment</option>
            <option value="airbnb">Airbnb</option>
            <option value="restaurant">Restaurant</option>
            <option value="office">Office</option>
          </select>
          <select name="cleaningType" defaultValue="standard" className="rounded-lg border border-border px-3 py-2 text-sm">
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
            <option value="move">Move-In/Move-Out</option>
          </select>
          <select name="condition" defaultValue="moderate" className="rounded-lg border border-border px-3 py-2 text-sm">
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="heavy">Heavy</option>
            <option value="extensive">Extensive</option>
          </select>
          <input name="bedrooms" type="number" min={0} defaultValue={2} placeholder="Bedrooms" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="fullBathrooms" type="number" min={0} defaultValue={2} placeholder="Full bathrooms" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="halfBathrooms" type="number" min={0} defaultValue={0} placeholder="Half bathrooms" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="squareFeet" type="number" min={0} placeholder="Square feet (optional)" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input name="serviceAddressLine1" placeholder="Street address" required className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="serviceAddressLine2" placeholder="Apt/Unit (optional)" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="serviceAddressCity" placeholder="City" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="serviceAddressState" placeholder="State" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="serviceAddressZip" placeholder="ZIP" required className="rounded-lg border border-border px-3 py-2 text-sm" />
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-muted">Scope add-ons (informational — included in the agreed price, never separately priced)</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ADD_ON_OPTIONS.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" name="addOnIds" value={option.id} />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Plan &amp; price</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <select name="frequency" defaultValue="one_time" className="rounded-lg border border-border px-3 py-2 text-sm">
            <option value="one_time">One-time</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="every_4_weeks">Every 4 weeks</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="isPrepaidPackage" />
            6+ prepaid package
          </label>
          <input name="visitCount" type="number" min={6} defaultValue={6} placeholder="Visit count (package only)" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input name="agreedTotal" type="number" min={0.01} step="0.01" required placeholder="Agreed price ($) — total for a package, per-visit otherwise" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </div>
        <p className="mt-2 text-xs text-muted">
          If this agreed price is below what CleanPerfecto&apos;s standard pricing would produce for the same scope, sending this invitation will require
          owner sign-off.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Pre-agreed appointment (optional)</h2>
        <p className="mt-1 text-xs text-muted">If a specific date/time was already agreed externally, enter it here — the customer will see it as a requested (not confirmed) visit. Leave blank to let the customer pick.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input name="agreedRequestedDate" type="date" className="rounded-lg border border-border px-3 py-2 text-sm" />
          <input name="agreedRequestedStartTime" type="time" className="rounded-lg border border-border px-3 py-2 text-sm" />
        </div>
      </section>

      <button type="submit" disabled={pending} className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? "Sending…" : "Send Invitation"}
      </button>

      {!pending && state && (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`} role={state.ok ? "status" : "alert"}>
          {state.ok ? (state.message ?? "Done.") : state.error}
        </p>
      )}
    </form>
  );
}
