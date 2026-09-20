import { describe, expect, it } from "vitest";
import { buildNotificationContent } from "@/lib/notifications/notification-content";
import { buildVisitPaymentQrCode } from "./visit-qr-code";

describe("buildVisitPaymentQrCode", () => {
  it("encodes the exact same secure Final Total URL the final_total_ready notification email links to", async () => {
    const visitId = "11111111-1111-1111-1111-111111111111";

    const qr = await buildVisitPaymentQrCode(visitId);
    const notification = buildNotificationContent({
      notificationType: "final_total_ready",
      customerName: "Jane",
      visitStartAtUtc: null,
      timezone: "America/Chicago",
      serviceVisitId: visitId,
    });

    expect(qr.url).toContain(`/my/payments?visit=${visitId}`);
    expect(notification.text).toContain(qr.url);
  });

  it("produces a scannable data: URI, not an external image host", async () => {
    const qr = await buildVisitPaymentQrCode("visit-1");
    expect(qr.qrDataUrl.startsWith("data:image/")).toBe(true);
  });

  it("is deterministic — the same visit id always resolves to the same destination", async () => {
    const first = await buildVisitPaymentQrCode("visit-1");
    const second = await buildVisitPaymentQrCode("visit-1");
    expect(first.url).toBe(second.url);
  });
});
