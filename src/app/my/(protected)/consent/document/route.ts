import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { assertCustomerOwnsDocumentPath } from "@/lib/consent/pdf/authorize-document-access";
import { SIGNED_CONSENTS_BUCKET } from "@/lib/consent/pdf/signed-consent-document-store";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

export const runtime = "nodejs";

/**
 * Server-authoritative download of the customer's OWN signed-consent PDF.
 * There is no id/customerId request parameter — the lookup is always
 * scoped to the authenticated session's own customerId (requireCustomer),
 * so there is no way to request another customer's document by supplying a
 * different id. assertCustomerOwnsDocumentPath is a second, defense-in-
 * depth check right before streaming bytes. The private bucket is never
 * exposed directly; every byte flows through this route via the
 * service-role admin client.
 */
export async function GET(): Promise<Response> {
  const session = await requireCustomer();
  const consentRepo = createSupabaseConsentRepository();

  const activeVersion = await consentRepo.findActiveVersion();
  if (!activeVersion) {
    return new Response("Not found", { status: 404 });
  }

  const record = await consentRepo.findByCustomerAndVersion(session.customerId, activeVersion.id);
  if (!record || record.state !== "signed" || !record.signedDocumentPath) {
    return new Response("Not found", { status: 404 });
  }

  assertCustomerOwnsDocumentPath(session.customerId, record.signedDocumentPath);

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(SIGNED_CONSENTS_BUCKET).download(record.signedDocumentPath);
  if (error || !data) {
    return new Response("Not found", { status: 404 });
  }

  const filename = record.signedDocumentPath.split("/").pop() ?? "signed-consent.pdf";
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
