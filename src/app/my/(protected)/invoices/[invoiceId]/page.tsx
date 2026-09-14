import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { assertInvoiceBelongsToCustomer, CustomerOwnershipError } from "@/lib/customer-portal/ownership";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";

export default async function MyInvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const session = await requireCustomer();
  const repo = createSupabaseSchedulingRepository();

  let invoice;
  try {
    invoice = await assertInvoiceBelongsToCustomer(repo, invoiceId, session.customerId);
  } catch (error) {
    if (error instanceof CustomerOwnershipError) notFound();
    throw error;
  }

  return <InvoiceDocument invoice={invoice} />;
}
