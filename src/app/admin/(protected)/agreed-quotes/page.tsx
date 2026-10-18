import Link from "next/link";
import { listAgreedQuoteInvitations } from "@/lib/admin/queries/agreed-quote-invitations";
import { formatMoney } from "@/lib/admin/format";

function statusLabel(status: string): string {
  switch (status) {
    case "pending_send":
      return "Pending Send";
    case "sent":
      return "Sent";
    case "checkout_in_progress":
      return "Checkout In Progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "superseded":
      return "Superseded";
    default:
      return status;
  }
}

export default async function AdminAgreedQuotesPage() {
  const invitations = await listAgreedQuoteInvitations();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Agreed Quotes</h1>
          <p className="mt-1 text-sm text-muted">Externally-negotiated offers sent as secure onboarding invitations.</p>
        </div>
        <Link href="/admin/agreed-quotes/new" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          Create &amp; Send Agreed Quote
        </Link>
      </div>

      {invitations.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No agreed quotes yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <Link href={`/admin/agreed-quotes/${invitation.id}`} className="flex items-center justify-between gap-4 p-4 text-sm hover:bg-background-alt">
                <div>
                  <p className="font-medium text-foreground">{invitation.customerName}</p>
                  <p className="text-muted">{invitation.customerEmail ?? "No email on file"}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-foreground">{formatMoney(invitation.calculationResult.prepaidPackageTotal ?? invitation.calculationResult.calculatedTotal)}</p>
                  <p className="text-muted">{statusLabel(invitation.status)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
