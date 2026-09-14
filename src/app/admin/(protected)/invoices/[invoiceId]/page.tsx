import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { hasCapability } from "@/lib/admin/rbac/capabilities";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";
import { voidInvoiceAction } from "@/lib/admin/actions/invoice-actions";
import ActionForm from "@/components/admin/ActionForm";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";

export default async function AdminInvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const admin = await requireAdmin();
  const repo = createSupabaseSchedulingRepository();
  const invoice = await repo.findInvoiceById(invoiceId);
  if (!invoice) notFound();

  const canVoid = hasCapability(admin.role, "financial_correction") && invoice.paymentStatus !== "void";

  return (
    <div className="space-y-6">
      <InvoiceDocument invoice={invoice} />
      {canVoid && (
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface p-5 print:hidden">
          <h2 className="text-sm font-semibold text-foreground">Void Invoice</h2>
          <ActionForm action={voidInvoiceAction} className="mt-2 space-y-2">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <textarea name="reason" required placeholder="Reason for voiding this invoice" className="w-full rounded-md border border-border p-2 text-sm" />
            <button type="submit" className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">
              Void Invoice
            </button>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
