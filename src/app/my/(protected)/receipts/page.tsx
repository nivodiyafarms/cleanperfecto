import Link from "next/link";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { formatMoney } from "@/lib/admin/format";

export default async function MyReceiptsPage() {
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();
  const receipts = await repo.listReceiptsForCustomer(session.customerId);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Receipts</h1>
      {receipts.length === 0 ? (
        <p className="text-sm text-muted">No receipts yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <Link href={`/my/receipts/${receipt.id}`} className="font-medium text-foreground hover:underline">
                  {receipt.receiptNumber}
                </Link>
                <div className="text-muted">{receipt.paymentMethodDisplay}</div>
              </div>
              <div className="text-right font-medium text-foreground">{formatMoney(receipt.amountPaid)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
