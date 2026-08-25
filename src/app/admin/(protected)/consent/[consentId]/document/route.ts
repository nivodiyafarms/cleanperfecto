import { AdminUnauthorizedError, requireAdmin } from "@/lib/admin/require-admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";
import { assertCustomerOwnsDocumentPath } from "@/lib/consent/pdf/authorize-document-access";
import { SIGNED_CONSENTS_BUCKET } from "@/lib/consent/pdf/signed-consent-document-store";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ consentId: string }>;
}

/**
 * Admin download of any customer's signed-consent PDF, gated by
 * requireAdmin() (redirects unauthenticated to /admin/login, throws
 * AdminUnauthorizedError for an authenticated non-admin — same gate every
 * other admin route/action uses). The private bucket is never exposed
 * directly; bytes are streamed only through this service-role-backed route.
 *
 * Unlike a page (which has an error.tsx boundary to render
 * AdminUnauthorizedError as an inline "access denied" screen), a Route
 * Handler has no such boundary — left uncaught, an authenticated non-admin
 * would surface a generic 500 instead of a clean denial. Caught here and
 * mapped to 403; an unauthenticated request's redirect() (a different,
 * framework-internal throw) is deliberately left uncaught so Next.js still
 * performs the real redirect to /admin/login.
 */
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminUnauthorizedError) {
      return new Response("Forbidden", { status: 403 });
    }
    throw error;
  }
  const { consentId } = await params;

  const consentRepo = createSupabaseConsentRepository();
  const record = await consentRepo.findById(consentId);
  if (!record || record.state !== "signed" || !record.signedDocumentPath) {
    return new Response("Not found", { status: 404 });
  }

  assertCustomerOwnsDocumentPath(record.customerId, record.signedDocumentPath);

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
