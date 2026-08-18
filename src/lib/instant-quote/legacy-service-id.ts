import type { ServiceId } from "@/lib/services";
import type { CleaningType, FrequencyId } from "@/lib/pricing/types";

/**
 * Backward-compatible mapping onto the legacy, still-NOT-NULL
 * quote_requests.service_id column, without corrupting the new orthogonal
 * cleaning_type/frequency model (both of which are always persisted
 * alongside this value — see build-quote-request-row.ts).
 *
 * one_time  -> service_id reflects the cleaning type (standard/deep/move)
 * recurring -> service_id = "recurring", regardless of cadence or whether
 *              it's a prepaid package; cleaning_type/frequency retain the
 *              real cadence and cleaning type separately.
 */
export function resolveLegacyServiceId(cleaningType: CleaningType, frequency: FrequencyId): ServiceId {
  return frequency === "one_time" ? cleaningType : "recurring";
}
