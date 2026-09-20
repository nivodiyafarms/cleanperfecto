import "server-only";

import QRCode from "qrcode";
import { buildPortalLink } from "@/lib/notifications/portal-link";

export interface VisitPaymentQrCode {
  /** The exact same secure CleanPerfecto Final Total URL sent by email — never a separate/parallel payment destination. */
  url: string;
  /** data: URI PNG — safe to render directly in an <img src>, no external image host involved. */
  qrDataUrl: string;
}

/**
 * On-site QR for the admin/cleaner-facing visit payment area — encodes the
 * SAME /my/payments?visit=<id> deep link as the Final Total notification
 * email, so scanning it opens the identical, ownership-checked customer
 * screen (see VisitPaymentFlow.tsx / assertVisitBelongsToCustomer). No
 * Stripe Terminal/Tap-to-Pay, no separate token — this is purely a
 * convenient encoding of an already-secure URL, generated locally (the
 * `qrcode` package does no network calls) rather than via a third-party QR
 * API, so the URL is never sent to an outside service.
 */
export async function buildVisitPaymentQrCode(serviceVisitId: string): Promise<VisitPaymentQrCode> {
  const url = buildPortalLink(`/my/payments?visit=${serviceVisitId}`);
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
  return { url, qrDataUrl };
}
