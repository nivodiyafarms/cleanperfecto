import { notFound } from "next/navigation";
import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import { getAgreedQuoteInvitationDetail } from "@/lib/admin/queries/agreed-quote-invitations";
import { formatMoney } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/require-admin";
import { hasCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseAgreedQuoteInvitationRepository } from "@/lib/instant-quote/supabase-agreed-quote-invitation-repository";
import { cancelAgreedQuoteInvitationAction, renewAgreedQuoteInvitationAction, resendAgreedQuoteInvitationAction } from "@/lib/admin/actions/agreed-quote-actions";

interface PageProps {
  params: Promise<{ invitationId: string }>;
}

export default async function AdminAgreedQuoteDetailPage({ params }: PageProps) {
  const { invitationId } = await params;
  const admin = await requireAdmin();
  const invitation = await getAgreedQuoteInvitationDetail(invitationId);
  if (!invitation) notFound();

  const canCreate = hasCapability(admin.role, "create_agreed_quote");
  const hasLiveAttempt = await createSupabaseAgreedQuoteInvitationRepository().hasLivePaymentAttemptForBookingOrder(invitation.bookingOrderId);

  const isPrepaidPackage = invitation.calculationInput.isPrepaidPackage;
  const canResend = canCreate && ["pending_send", "sent", "checkout_in_progress"].includes(invitation.status);
  const canRenew = canCreate && !["completed", "cancelled", "superseded"].includes(invitation.status);
  const canRevise = canCreate && ["pending_send", "sent"].includes(invitation.status);
  const canCancel = canCreate && ["pending_send", "sent", "checkout_in_progress"].includes(invitation.status) && !(invitation.status === "checkout_in_progress" && hasLiveAttempt);

  return (
    <div>
      <Link href="/admin/agreed-quotes" className="text-sm text-muted hover:text-foreground">
        ← Agreed Quotes
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-foreground">{invitation.customerName}</h1>
      <p className="text-sm text-muted">{invitation.customerEmail ?? "No email on file"}</p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Agreed scope &amp; price</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Cleaning type</dt>
            <dd className="text-foreground">{invitation.cleaningType}</dd>
          </div>
          <div>
            <dt className="text-muted">Frequency</dt>
            <dd className="text-foreground">{invitation.calculationInput.frequency}</dd>
          </div>
          {isPrepaidPackage ? (
            <>
              <div>
                <dt className="text-muted">Price per visit</dt>
                <dd className="text-foreground">{formatMoney(invitation.calculationResult.effectivePricePerVisit ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-muted">Total for {invitation.calculationInput.visitCount} prepaid visits</dt>
                <dd className="text-foreground font-medium">{formatMoney(invitation.calculationResult.prepaidPackageTotal ?? 0)}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt className="text-muted">Agreed price</dt>
              <dd className="text-foreground font-medium">{formatMoney(invitation.calculationResult.calculatedTotal)}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted">Status</dt>
            <dd className="text-foreground">{invitation.status}</dd>
          </div>
          <div>
            <dt className="text-muted">Expires</dt>
            <dd className="text-foreground">{new Date(invitation.expiresAt).toLocaleString()}</dd>
          </div>
          {invitation.negotiationChannel && (
            <div>
              <dt className="text-muted">Negotiated via</dt>
              <dd className="text-foreground">{invitation.negotiationChannel}</dd>
            </div>
          )}
          {invitation.bookingOrderId && (
            <div>
              <dt className="text-muted">Booking order</dt>
              <dd className="text-foreground">{invitation.bookingOrderId}</dd>
            </div>
          )}
        </dl>
        {invitation.negotiationNotes && <p className="mt-3 text-sm text-muted">{invitation.negotiationNotes}</p>}
        <p className="mt-3 text-xs text-muted">
          Resent {invitation.resendCount} time(s){invitation.lastSentAt ? `, last sent ${new Date(invitation.lastSentAt).toLocaleString()}` : ""}. Renewed{" "}
          {invitation.renewCount} time(s).
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {canResend && (
          <ActionForm action={resendAgreedQuoteInvitationAction}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
              Resend
            </button>
          </ActionForm>
        )}

        {canRenew && (
          <ActionForm action={renewAgreedQuoteInvitationAction}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <label className="mb-2 flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" name="confirmedPriceAndAvailability" required />
              I&apos;ve reviewed this price and availability — still accurate
            </label>
            <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
              Renew
            </button>
          </ActionForm>
        )}

        {canRevise && (
          <Link
            href={`/admin/agreed-quotes/new?supersedesInvitationId=${invitation.id}`}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt"
          >
            Revise
          </Link>
        )}

        {canCancel && (
          <ActionForm action={cancelAgreedQuoteInvitationAction}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <button type="submit" className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
              Cancel
            </button>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
