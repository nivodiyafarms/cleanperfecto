/**
 * Public restatement of consent_versions seed CP-CONSENT-2026-01.
 * The signed copy lives in
 * supabase/migrations/20260827090000_create_consent_versions.sql.
 * is_legally_reviewed is false there — this is a business template.
 */
export const SERVICE_CONSENT_TEMPLATE = {
  versionLabel: "CP-CONSENT-2026-01",
  title: "CleanPerfecto Service Consent Agreement",
  isLegallyReviewed: false,
  bodyText: `CLEANPERFECTO SERVICE CONSENT AGREEMENT

By checking the acknowledgment box, typing your full legal name, and submitting this form, you authorize and agree to the following terms as one complete agreement covering your CleanPerfecto services.

SERVICE AUTHORIZATION

You authorize CleanPerfecto and its cleaning team to enter and access the areas of your property made available for the requested cleaning or related service.

You authorize the CleanPerfecto team to move furniture and other household items when reasonably necessary and safe to complete the requested service and to return moved items to approximately their original location when practical.

Please secure or identify any fragile, valuable, sensitive, personal, or irreplaceable items that you do not want the CleanPerfecto team to move or handle.

You agree to inform CleanPerfecto before service of any restricted areas, unsafe conditions, pets, alarms, access instructions, special surfaces or materials, or other conditions that our team should know about.

PHOTO, VIDEO, MARKETING & YARD SIGN PERMISSION

You authorize CleanPerfecto to take photos or videos of the cleaning work and service areas before, during, or after service.

You authorize CleanPerfecto to use such photos or videos for legitimate CleanPerfecto business and marketing purposes, including its website, social media, advertisements, promotional materials, before-and-after examples, and other CleanPerfecto business communications.

You also authorize CleanPerfecto to place a CleanPerfecto yard sign at the property when appropriate. The sign may remain at the property until the next scheduled CleanPerfecto visit or until you or the property representative removes it, whichever occurs first.

SERVICE INFORMATION

You agree to provide reasonably accurate information about the property, requested service, condition of the areas to be cleaned, and any special instructions that may affect the service.

If the requested work or property condition is materially different from the information originally provided, CleanPerfecto may discuss any necessary changes to the scope, time, or price with you before performing additional work beyond the previously approved scope.

ELECTRONIC ACKNOWLEDGMENT

By checking the acknowledgment box, typing your full legal name, and submitting this form, you confirm that you have read and agree to this entire CleanPerfecto Service Consent Agreement.

You understand that your typed legal name and electronic submission constitute your acknowledgment and electronic signature to this agreement.`,
} as const;
