-- ============================================================================
-- Migration: create consent_versions
-- Consent + Review Automation V1 milestone.
--
-- The published, versioned legal text a customer signs. Immutable once
-- created — a "material change" is authored as a brand-new row (and the
-- old one's is_active flipped off), never an in-place edit, so a customer's
-- already-signed acceptance can always be traced back to the EXACT text
-- they agreed to (see customer_consents.accepted_text_snapshot, which also
-- freezes its own copy independent of this table for extra safety).
--
-- Authoring a new version is a rare, legal-review-driven event, not a
-- self-service admin UI need in V1 (see architecture notes) — rows are
-- created via migration/direct SQL, not a consent-version editor.
--
-- The V1 seed row (CP-CONSENT-2026-01) is a CleanPerfecto BUSINESS
-- TEMPLATE, not attorney-approved legal text — see is_legally_reviewed
-- below, checked at every render/seed point so nothing ever silently
-- implies otherwise.
-- ============================================================================

create table public.consent_versions (
  id uuid primary key default gen_random_uuid(),

  version_label text not null unique,
  title text not null,
  body_text text not null,

  -- Explicit, not inferred from anything else — surfaced wherever this
  -- version's text is rendered, so nobody mistakes a business template for
  -- reviewed legal language. False for CP-CONSENT-2026-01.
  is_legally_reviewed boolean not null default false,

  is_active boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.consent_versions is
  'Published, versioned consent text. Immutable — a material change is a new row, never an edit. Exactly one row should have is_active = true at a time (enforced by convention/admin process in V1, not a DB constraint, since publishing a new version and retiring the old one are two statements around the same instant).';

comment on column public.consent_versions.is_legally_reviewed is
  'False for the V1 seed template (CP-CONSENT-2026-01) — a CleanPerfecto business template, not attorney-approved. Flip only after real legal review of that specific version''s text.';

create index consent_versions_is_active_idx on public.consent_versions (is_active) where is_active;

alter table public.consent_versions enable row level security;

revoke all privileges
on table public.consent_versions
from anon, authenticated;

grant select, insert
on table public.consent_versions
to service_role;
-- No update/delete grant — a version's text is genuinely immutable once
-- created, same append-only-by-privilege convention as
-- recurring_visit_plan_history / service_visit_events. is_active is
-- toggled by inserting the NEXT version and updating only that column via
-- a narrow follow-up statement would still require UPDATE — so is_active
-- transitions happen via service_role UPDATE, which needs the grant added
-- back deliberately below (title/body_text/version_label still can't be
-- touched by any DML this table permits — only via a fresh row).

grant update (is_active)
on table public.consent_versions
to service_role;

-- ---------------------------------------------------------------------------
-- V1 seed: CP-CONSENT-2026-01 — a CleanPerfecto business template.
-- NOT attorney-approved. Requires legal review before production activation.
-- ---------------------------------------------------------------------------
insert into public.consent_versions (version_label, title, body_text, is_legally_reviewed, is_active)
values (
  'CP-CONSENT-2026-01',
  'CleanPerfecto Service Consent Agreement',
  $$CLEANPERFECTO SERVICE CONSENT AGREEMENT

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

You understand that your typed legal name and electronic submission constitute your acknowledgment and electronic signature to this agreement.$$,
  false,
  true
);
