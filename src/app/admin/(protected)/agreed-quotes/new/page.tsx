import Link from "next/link";
import AgreedQuoteForm from "@/components/admin/AgreedQuoteForm";
import { searchCustomersByContact } from "@/lib/admin/queries/agreed-quote-invitations";

interface PageProps {
  searchParams: Promise<{ q?: string; existingCustomerId?: string; existingCustomerName?: string; existingCustomerEmail?: string; supersedesInvitationId?: string }>;
}

export default async function NewAgreedQuotePage({ searchParams }: PageProps) {
  const { q, existingCustomerId, existingCustomerName, existingCustomerEmail, supersedesInvitationId } = await searchParams;
  const results = q && !existingCustomerId ? await searchCustomersByContact(q) : [];

  return (
    <div>
      <Link href="/admin/agreed-quotes" className="text-sm text-muted hover:text-foreground">
        ← Agreed Quotes
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-foreground">Create &amp; Send Agreed Quote</h1>
      <p className="mt-1 text-sm text-muted">For a customer whose service terms were already negotiated externally.</p>

      {!existingCustomerId && (
        <form className="mt-6 flex gap-2" action="/admin/agreed-quotes/new">
          {supersedesInvitationId && <input type="hidden" name="supersedesInvitationId" value={supersedesInvitationId} />}
          <input name="q" defaultValue={q ?? ""} placeholder="Search existing customers by name, email, or phone" className="flex-1 rounded-lg border border-border px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
            Search
          </button>
        </form>
      )}

      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface">
          {results.map((customer) => (
            <li key={customer.id}>
              <Link
                href={`/admin/agreed-quotes/new?existingCustomerId=${customer.id}&existingCustomerName=${encodeURIComponent(customer.name)}&existingCustomerEmail=${encodeURIComponent(customer.email ?? "")}${supersedesInvitationId ? `&supersedesInvitationId=${supersedesInvitationId}` : ""}`}
                className="flex items-center justify-between gap-4 p-3 text-sm hover:bg-background-alt"
              >
                <span className="font-medium text-foreground">{customer.name}</span>
                <span className="text-muted">{customer.email ?? customer.phone ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <AgreedQuoteForm
        existingCustomerId={existingCustomerId}
        existingCustomerName={existingCustomerName}
        existingCustomerEmail={existingCustomerEmail}
        supersedesInvitationId={supersedesInvitationId}
      />
    </div>
  );
}
