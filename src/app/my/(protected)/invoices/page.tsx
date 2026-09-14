import Link from "next/link";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { formatMoney } from "@/lib/admin/format";

export default async function MyInvoicesPage() {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  const invoices = await repo.listInvoicesForCustomer(session.customerId);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
      {invoices.length === 0 ? (
        <p className="text-sm text-muted">No invoices yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Link href={`/my/invoices/${invoice.id}`} className="font-medium text-foreground hover:underline">
                  {invoice.invoiceNumber}
                </Link>
                <div className="text-muted">{invoice.description}</div>
              </div>
              <div className="text-right">
                <div className="font-medium text-foreground">{formatMoney(invoice.totalAmount)}</div>
                <div className="text-muted">{invoice.paymentStatus}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
